// Simple wrapper around AWS S3 API v3
// Copyright (c) 2023 - 2024 Joseph Huckaby, MIT License

"use strict";

const fs = require('fs');
const zlib = require('zlib');
const Path = require('path');
const mime = require('mime-types');
const Tools = require('pixl-tools');
const LRU = require('pixl-cache');
const { Readable } = require('stream');
const streamToBuffer = require("fast-stream-to-buffer");
const { asyncify } = require('pixl-class-util');
const S3 = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { NodeHttpHandler } = require("@smithy/node-http-handler");

const async = Tools.async;

/** 
 * S3API class wraps the AWS S3 SDK and provides a convenient API atop it. 
 */
class S3API {
	
	region = 'us-west-1';
	bucket = '';
	prefix = '';
	params = null;
	retries = 50;
	timeout = 5000;
	connectTimeout = 5000;
	logger = null;
	perf = null;
	gzip = {};
	
	/**
	 * Construct an S3API class instance.
	 * @param {Object} args - Arguments for configuring the S3 connection.
	 * @param {string} args.region - The AWS region in which your S3 bucket resides.
	 * @param {string} args.bucket - The AWS S3 Bucket name to connect to.
	 * @param {Object} [args.credentials] - Your AWS credentials for the S3 connection.
	 * @param {string} [args.credentials.accessKeyId] - Your AWS Access Key ID.
	 * @param {string} [args.credentials.secretAccessKey] - Your AWS Secret Access Key.
	 * @param {string} [args.prefix] - An option string to prefix onto all S3 paths.
	 * @param {Object} [args.params] - Optional params to pass to the AWS SDK.
	 * @param {string} [args.retries=50] - Optionally set the number of retries for failed operations.
	 * @param {string} [args.timeout=5000] - Optionally set the S3 operation timeout in milliseconds.
	 * @param {string} [args.connectTimeout=5000] - Optionally set the S3 connect timeout in milliseconds.
	 * @param {Object} [args.logger] - Optional pixl-logger compatible log agent.
	 * @param {Object} [args.perf] - Optional pixl-perf compatible perf tracker.
	 * @param {Object} [args.gzip] - Optionally configure the gzip (zlib) properties.
	 * @param {(Object|boolean)} [args.cache] - Optionally enable and configure the key/value LRU cache.
	 */
	constructor(args = {}) {
		// optional: { credentials, region, bucket, prefix, params, timeout, connectTimeout, retries, logger, perf, gzip, cache }
		Tools.mergeHashInto(this, args);
		
		let opts = {
			region: this.region,
			maxAttempts: this.retries,
			requestHandler: new NodeHttpHandler({
				connectionTimeout: this.connectTimeout,
				socketTimeout: this.timeout
			})
		};
		if (this.credentials) opts.credentials = this.credentials;
		
		// add ref to S3 class so users can send custom commands
		this.S3 = S3;
		
		// construct s3 client
		this.s3 = new S3.S3Client(opts);
		
		// optional cache layer for JSON records
		if (this.cache) this.setupCache();
	}
	
	/** 
	 * Setup the LRU cache subsystem.
	 * @private
	 */
	setupCache() {
		// setup caching layer using pixl-cache
		let self = this;
		if (typeof(this.cache) != 'object') this.cache = {};
		if (!this.cache.keyMatch) this.cache.keyMatch = /.+/;
		
		this.lru = new LRU( this.cache );
		this.lru.on( 'expire', function(item, reason) {
			self.logDebug(9, `Cache expired ${item.key} because of ${reason}.`);
		});
	}
	
	/** 
	 * Attach a pixl-logger compatible log agent.
	 * @param {Object} agent - The pixl-logger instance to attach and use.
	 */
	attachLogAgent(agent) {
		// attach a pixl-logger compatible agent for debug logging
		this.logger = agent;
	}
	
	/** 
	 * Attach a pixl-perf compatible perf tracker.
	 * @param {Object} perf - The pixl-perf instance to attach and use.
	 */
	attachPerfAgent(perf) {
		// attach a pixl-perf compatible agent for perf tracking
		this.perf = perf;
	}
	
	/** 
	 * @typedef {Object} MetaResponse
	 * @property {Object} meta - Raw metadata object from the AWS S3 service.
	 */
	
	/**
	 * Serialize object to JSON and store as buffer, acting as a key/value store.
	 * @param {Object} opts - The options object for the put operation.
	 * @param {string} opts.key - The key (S3 path) to store the object under.
	 * @param {Object} opts.value - The value to store as the object content.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {Object} [opts.params] - Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class. 
	 * @param {boolean} [opts.pretty=false] - Optionally pretty-print the JSON.
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @returns {Promise<MetaResponse>} - A promise that resolves to a custom object.
	 */
	put(opts, callback) {
		// serialize object to JSON and store as buffer
		// opts: { bucket, key, value, pretty, params }
		// result: { metadata }
		let self = this;
		if (!opts.value) return callback( new Error("Missing required 'value' (object) property.") );
		if (typeof(opts.value) != 'object') return callback( new Error("The 'value' property must be an object.") );
		if (Buffer.isBuffer(opts.value)) return callback( new Error("The 'value' property must be an object (not a Buffer).") );
		
		this.logDebug(8, "Storing JSON record: " + opts.key, Tools.copyHashRemoveKeys(opts, { value:1 }));
		
		// serialize and bufferize
		let orig_value = opts.value;
		opts.value = Buffer.from( opts.pretty ? JSON.stringify(opts.value, null, "\t") : JSON.stringify(opts.value) );
		
		if (!opts.params) opts.params = {};
		if (!opts.params.ContentType) opts.params.ContentType = 'application/json';
		
		this.putBuffer(opts, function(err, data) {
			if (err) return callback(err, null);
			
			if (self.cache && opts.key.match(self.cache.keyMatch)) {
				// store in cache
				self.lru.set( opts.key, orig_value );
			}
			
			callback(null, data);
		});
	}
	
	/** 
	 * @typedef {Object} GetResponse
	 * @property {Object} data - The value of the requested S3 object.
	 * @property {Object} meta - Raw metadata object from the AWS S3 service.
	 */
	
	/**
	 * Fetch buffer from S3 and parse as JSON (key/value store).
	 * @param {Object} opts - The options object for the get operation.
	 * @param {string} opts.key - The key (S3 path) to fetch.
	 * @param {string} [opts.subpath] - Optionally fetch a subpath using dot.path.notation.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @returns {Promise<GetResponse>} - A promise that resolves to a custom object.
	 */
	get(opts, callback) {
		// fetch buffer from S3 and parse as JSON
		// opts: { bucket, key }
		// result: { json, metadata }
		let self = this;
		if (typeof(opts) == 'string') opts = { key: opts };
		
		if (this.cache && opts.key.match(this.cache.keyMatch)) {
			// chceck if item is in cache
			let value = this.lru.get(opts.key);
			if (value) {
				// item is in cache and still fresh, use it
				this.logDebug(8, "Using JSON record from cache: " + opts.key, opts);
				return process.nextTick( function() { 
					callback( null, opts.subpath ? Tools.getPath(value, opts.subpath) : value, { cached: true } ); 
				} );
			}
		}
		
		this.logDebug(8, "Fetching JSON record: " + opts.key, opts);
		
		this.getBuffer(opts, function(err, buf, meta) {
			if (err) return callback(err);
			
			let json = null;
			try { json = JSON.parse( buf.toString() ); }
			catch (err) {
				self.logError('json', "Failed to parse JSON record: " + opts.key + ": " + err);
				return callback( err, null, null );
			}
			
			if (self.cache && opts.key.match(self.cache.keyMatch)) {
				// store in cache
				self.lru.set( opts.key, json );
			}
			
			self.logDebug(9, "JSON fetch complete: " + opts.key);
			callback( null, opts.subpath ? Tools.getPath(json, opts.subpath) : json, meta );
		});
	}
	
	/**
	 * Update JSON record by using dot.path.notation to add/replace/delete properties.
	 * @param {Object} opts - The options object for the update operation.
	 * @param {string} opts.key - The key (S3 path) to update.
	 * @param {Object} opts.updates - The value containing properties to update.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @returns {Promise<GetResponse>} - A promise that resolves to a custom object.
	 */
	update(opts, callback) {
		// Update JSON record
		// opts: { bucket, key, updates }
		// result: { data, metadata }
		let self = this;
		if (!opts.updates) return callback( new Error("Missing required 'updates' (object) property.") );
		if (typeof(opts.updates) != 'object') return callback( new Error("The 'updates' property must be an object.") );
		if (Buffer.isBuffer(opts.updates)) return callback( new Error("The 'updates' property must be an object (not a Buffer).") );
		
		this.logDebug(8, "Updating JSON record: " + opts.key, opts);
		
		let updates = opts.updates;
		delete opts.updates;
		
		// first load the record
		this.get( opts, function(err, data) {
			if (err) return callback(err);
			
			// apply updates
			for (let key in updates) {
				Tools.setPath( data, key, updates[key] );
			}
			
			// save the record
			opts.value = data;
			self.put( opts, function(err, meta) {
				if (err) return callback(err);
				callback( null, data, meta );
			} );
		}); // get
	}
	
	/** 
	 * @typedef {Object} HeadResponse
	 * @property {Object} meta - Raw metadata object from the AWS S3 service, augmented with extras.
	 * @property {number} meta.size - The size of the content in bytes.
	 * @property {number} meta.mtime - The last modified date of the object as Epoch seconds.
	 */
	
	/**
	 * See if object exists, and get its size and mod date.
	 * @param {Object} opts - The options object for the head operation.
	 * @param {string} opts.key - The key (S3 path) to head.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @returns {Promise<HeadResponse>} - A promise that resolves to a custom object.
	 */
	head(opts, callback) {
		// see if object exists, and get its size & mod date
		// opts: { bucket, key, nonfatal }
		// result: { meta(size, mtime) }
		let self = this;
		if (typeof(opts) == 'string') opts = { key: opts };
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		
		let params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Key = this.prefix + opts.key;
		
		this.logDebug(8, "Pinging key: " + opts.key, params);
		
		let tracker = this.perf ? this.perf.begin('s3_head') : null;
		this.s3.send( new S3.HeadObjectCommand(params) )
			.then( function(data) {
				// data: { LastModified, ContentLength }
				data.size = data.ContentLength;
				data.mtime = data.LastModified.getTime() / 1000;
				
				if (tracker) tracker.end();
				self.logDebug(9, "Head complete: " + opts.key, data);
				process.nextTick( function() { callback(null, data); });
			} )
			.catch( function(err) {
				if (tracker) tracker.end();
				if ((err.name == 'NoSuchKey') || (err.name == 'NotFound') || (err.code == 'NoSuchKey') || (err.code == 'NotFound')) {
					// key not found, special case, don't log an error
					// always include "Not found" in error message
					err = new Error("Failed to fetch key: " + opts.key + ": Not found");
					err.code = "NoSuchKey";
					
					// or in non-fatal mode, suppress error entirely
					if (opts.nonfatal) err = null;
				}
				else {
					// some other error
					self.logError('head', "Failed to fetch key: " + opts.key + ": " + (err.message || err), err);
				}
				process.nextTick( function() { callback( err, null ); });
			} );
	}
	
	/**
	 * Copy a single object from one location to another.
	 * @param {Object} opts - The options object for the copy operation.
	 * @param {Object} opts.sourceKey - The S3 key to copy from.
	 * @param {string} opts.key - The S3 key to copy the object to. 
	 * @param {Object} [opts.sourceBucket] - Optionally override the S3 bucket used to read the source record.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket used to store the destination record.
	 * @param {Object} [opts.params] - Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class. 
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @returns {Promise<MetaResponse>} - A promise that resolves to a custom object.
	 */
	copy(opts, callback) {
		// copy a single object from one location to another
		// opts: { sourceBucket, sourceKey, bucket, key, params }
		// result: { metadata }
		let self = this;
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.sourceBucket) opts.sourceBucket = this.bucket;
		if (!opts.sourceBucket) return callback( new Error("Missing required 'sourceBucket' (string) property.") );
		if (!opts.sourceKey) return callback( new Error("Missing required 'sourceKey' (string) property.") );
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		
		let params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.CopySource = opts.sourceBucket + '/' + this.prefix + opts.sourceKey;
		params.Bucket = opts.bucket;
		params.Key = this.prefix + opts.key;
		
		this.logDebug(8, "Copying object: " + opts.sourceKey + " to: " + opts.key, params);
		
		if (opts.dry) {
			this.logDebug(9, "Dry-run, returning faux success");
			return process.nextTick( function() { callback(null, { dry: true }); } );
		}
		
		let tracker = this.perf ? this.perf.begin('s3_copy') : null;
		this.s3.send( new S3.CopyObjectCommand(params) )
			.then( function(data) {
				if (tracker) tracker.end();
				self.logDebug(9, "Copy complete: " + opts.key, data);
				process.nextTick( function() { callback(null, data); });
			} )
			.catch( function(err) {
				if (tracker) tracker.end();
				if ((err.name == 'NoSuchKey') || (err.name == 'NotFound') || (err.code == 'NoSuchKey') || (err.code == 'NotFound')) {
					// key not found, special case, don't log an error
					// always include "Not found" in error message
					err = new Error("Failed to copy object: " + opts.key + ": Not found");
					err.code = "NoSuchKey";
				}
				else {
					// some other error
					self.logError('head', "Failed to copy object: " + opts.key + ": " + (err.message || err), err);
				}
				process.nextTick( function() { callback( err, null ); });
			} );
	}
	
	/**
	 * Recursively copies multiple files / directories from S3 to S3.
	 * @param {Object} opts - The options object for the downloadFiles operation.
	 * @param {string} opts.remotePath - The base S3 path to fetch files from.
	 * @param {string} opts.destPath - The base S3 path to copy files to.
	 * @param {RegExp} [opts.filespec] - Optionally filter the S3 files using a regular expression, matched on the filenames.
	 * @param {Function} [opts.filter] - Optionally provide a filter function to select which files to include.
	 * @param {number} [opts.threads=1] - Optionally increase the threads to improve performance.
	 * @param {Object} [opts.sourceBucket] - Optionally override the S3 bucket used to read the source files.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {Function} [opts.progress] - A function to receive progress udpates.
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @returns {Promise<ListResponse>} - A promise that resolves to a custom object.
	 */
	copyFiles(opts, callback) {
		// copy multiple files using s3 list
		// opts: { sourceBucket, remotePath, bucket, destPath, filespec, threads }
		// result: { files([{ key, size, mtime }, ...]), total_bytes }
		let self = this;
		
		// we want EVERYTHING, including those 0-byte folder markers
		opts.emptyFolders = true;
		
		this.list(opts, function(err, files, bytes) {
			if (err) return callback(err, null, null);
			
			// setup progress
			var progressHandler = opts.progress || function() {};
			delete opts.progress; // don't pass this down to copy
			var total = bytes;
			var loaded = 0;
			
			self.logDebug(8, "Copying " + files.length + " files", files);
			
			async.eachLimit( files, opts.threads || 1,
				function(file, callback) {
					opts.sourceKey = file.key;
					opts.key = opts.destPath + file.key.slice(self.prefix.length + opts.remotePath.length);
					self.copy( opts, function(err) {
						if (err) return callback(err);
						
						// update progress
						loaded += file.size;
						progressHandler({ loaded, total });
						
						callback();
					} ); // copy
				},
				function(err) {
					if (err) return callback(err, null, null);
					self.logDebug(9, "All files moved successfully");
					callback(null, files, bytes);
				}
			); // eachLimit
		}); // list
	}
	
	/**
	 * Move a single object from one location to another.
	 * @param {Object} opts - The options object for the move operation.
	 * @param {Object} opts.sourceKey - The S3 key to copy from.
	 * @param {string} opts.key - The S3 key to copy the object to. 
	 * @param {Object} [opts.sourceBucket] - Optionally override the S3 bucket used to read the source record.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket used to store the destination record.
	 * @param {Object} [opts.params] - Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class. 
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @returns {Promise<MetaResponse>} - A promise that resolves to a custom object.
	 */
	move(opts, callback) {
		// move a single object from one location to another
		// opts: { sourceBucket, sourceKey, bucket, key, params }
		// result: { metadata }
		let self = this;
		
		this.copy(opts, function(err) {
			if (err) return callback(err);
			
			// now delete the source
			self.delete( Tools.mergeHashes(opts, { bucket: opts.sourceBucket || self.bucket, key: opts.sourceKey }), callback);
		});
	}
	
	/**
	 * Recursively copies multiple files / directories from S3 to S3.
	 * @param {Object} opts - The options object for the downloadFiles operation.
	 * @param {string} opts.remotePath - The base S3 path to fetch files from.
	 * @param {string} opts.destPath - The base S3 path to move files to.
	 * @param {RegExp} [opts.filespec] - Optionally filter the S3 files using a regular expression, matched on the filenames.
	 * @param {Function} [opts.filter] - Optionally provide a filter function to select which files to include.
	 * @param {number} [opts.threads=1] - Optionally increase the threads to improve performance.
	 * @param {Object} [opts.sourceBucket] - Optionally override the S3 bucket used to read the source files.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {Function} [opts.progress] - A function to receive progress udpates.
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @returns {Promise<ListResponse>} - A promise that resolves to a custom object.
	 */
	moveFiles(opts, callback) {
		// move multiple files using s3 list
		// opts: { sourceBucket, remotePath, bucket, destPath, filespec, threads }
		// result: { files([{ key, size, mtime }, ...]), total_bytes }
		let self = this;
		
		// we want EVERYTHING, including those 0-byte folder markers
		opts.emptyFolders = true;
		
		this.list(opts, function(err, files, bytes) {
			if (err) return callback(err, null, null);
			
			// setup progress
			var progressHandler = opts.progress || function() {};
			delete opts.progress; // don't pass this down to move
			var total = bytes;
			var loaded = 0;
			
			self.logDebug(8, "Moving " + files.length + " files", files);
			
			async.eachLimit( files, opts.threads || 1,
				function(file, callback) {
					opts.sourceKey = file.key;
					opts.key = opts.destPath + file.key.slice(self.prefix.length + opts.remotePath.length);
					
					self.move( opts, function(err) {
						if (err) return callback(err);
						
						// update progress
						loaded += file.size;
						progressHandler({ loaded, total });
						
						callback();
					} ); // move
				},
				function(err) {
					if (err) return callback(err, null, null);
					self.logDebug(9, "All files moved successfully");
					callback(null, files, bytes);
				}
			); // eachLimit
		}); // list
	}
	
	/** 
	 * @typedef {Object} ListFoldersResponse
	 * @property {string[]} folders - An array of S3 path prefixes for subfolders just under the current level.
	 * @property {Object[]} files - An array of file objects at the current folder level.
	 * @property {string} files[].key - The object's full S3 key (including prefix if applicable).
	 * @property {number} files[].size - The objects's size in bytes.
	 * @property {number} files[].mtime - The object's modification date, as Epoch seconds.
	 */
	
	/** 
	 * List only subfolders from a start path -- single level and no pagination
	 * @param {Object} opts - The options object for the listFolders operation.
	 * @param {string} opts.remotePath - The base S3 path to look for folders under.
	 * @param {string} [opts.delimiter=/] - Optionally override the delimiter for directory indexing.
	 * @param {string} [opts.bucket] - Optionally specify the S3 bucket where the folders reside.
	 * @returns {Promise<ListFoldersResponse>} - A promise that resolves to a custom object.
	 */
	listFolders(opts, callback) {
		// list only subfolders from a start path -- single level and no pagination
		// opts: { bucket, remotePath, delimiter }
		// result: { folders, files }
		let self = this;
		
		if (typeof(opts) == 'string') opts = { remotePath: opts };
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.remotePath) opts.remotePath = '';
		
		let params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Prefix = this.prefix + opts.remotePath;
		params.MaxKeys = 1000;
		params.Delimiter = opts.delimiter || '/';
		
		if (params.Prefix.length && !params.Prefix.endsWith(params.Delimiter)) params.Prefix += params.Delimiter;
		
		this.logDebug(8, "Listing S3 subfolders with prefix: " + params.Prefix, opts);
		let tracker = this.perf ? this.perf.begin('s3_list') : null;
		
		this.s3.send( new S3.ListObjectsV2Command(params) )
			.then( function(data) {
				if (tracker) tracker.end();
				
				let folders = (data.CommonPrefixes || []).map( function(item) { 
					return item.Prefix; 
				} );
				
				let files = (data.Contents || []).map( function(item) {
					return { key: item.Key, size: item.Size, mtime: item.LastModified.getTime() / 1000 };
				} );
				
				self.logDebug(9, "S3 subfolder listing complete (" + folders.length + " paths, " + files.length + " files)", {
					prefix: params.Prefix
				});
				
				// break out of promise context
				process.nextTick( function() { callback( null, folders, files ); } );
			} )
			.catch( function(err) {
				if (tracker) tracker.end();
				
				// break out of promise context
				return process.nextTick( function() { callback( err, null, null ); });
			} );
	}
	
	/** 
	 * @typedef {Object} ListResponse
	 * @property {number} bytes - The total number of bytes used by all matched objects.
	 * @property {Object[]} files - An array of file objects that matched your criteria.
	 * @property {string} files[].key - The object's full S3 key (including prefix if applicable).
	 * @property {number} files[].size - The objects's size in bytes.
	 * @property {number} files[].mtime - The object's modification date, as Epoch seconds.
	 */
	
	/** 
	 * Generate list of objects in S3 given prefix
	 * @param {Object} opts - The options object for the list operation.
	 * @param {string} opts.remotePath - The base S3 path to look for files under.
	 * @param {RegExp} [opts.filespec] - Optionally filter the result files using a regular expression, matched on the filenames.
	 * @param {Function} [opts.filter] - Optionally provide a filter function to select which files to include.
	 * @param {(number|string)} [opts.older] - Optionally filter the S3 files based on their modification date.
	 * @param {boolean} [opts.emptyFolders=false] - Optionally include 0-byte empty folder markers.
	 * @param {string} [opts.bucket] - Optionally specify the S3 bucket where the folders reside.
	 * @returns {Promise<ListResponse>} - A promise that resolves to a custom object.
	 */
	list(opts, callback) {
		// generate list of objects in S3 given prefix
		// this repeatedly calls ListObjectsV2 for lists > 1000
		// opts: { bucket, remotePath, filespec, filter }
		// result: { files([{ key, size, mtime }, ...]), total_bytes }
		let self = this;
		let done = false;
		let files = [];
		let total_bytes = 0;
		let num_calls = 0;
		let now = Tools.timeNow(true);
		
		if (typeof(opts) == 'string') opts = { remotePath: opts };
		if (opts.filter && opts.older) return callback( new Error("The 'filter' and 'older' properties are mutually exclusive.") );
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.remotePath) opts.remotePath = '';
		if (!opts.filespec) opts.filespec = /.*/;
		if (!opts.filter) opts.filter = function() { return true; };
		
		if (opts.older) {
			// convert older to filter func with mtime
			if (typeof(opts.older) == 'string') opts.older = Tools.getSecondsFromText( opts.older );
			opts.filter = function(file) { return file.mtime <= now - opts.older; };
		}
		
		let params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Prefix = this.prefix + opts.remotePath;
		params.MaxKeys = 1000;
		
		this.logDebug(8, "Listing S3 files with prefix: " + params.Prefix, opts);
		let tracker = this.perf ? this.perf.begin('s3_list') : null;
		
		async.whilst(
			function() { 
				return !done; 
			},
			function(callback) {
				self.logDebug(9, "Listing chunk", params);
				
				self.s3.send( new S3.ListObjectsV2Command(params) )
					.then( function(data) {
						let items = data.Contents || [];
						
						items.forEach( function(item) {
							let key = item.Key;
							let bytes = item.Size;
							let mtime = item.LastModified.getTime() / 1000;
							let file = { key: key, size: bytes, mtime: mtime };
							
							// skip over 0-byte folder markers
							if (!bytes && key.match(/\/$/) && !opts.emptyFolders) return;
							
							// optional filter and filespec
							if (opts.filter(file) && Path.basename(key).match(opts.filespec)) {
								total_bytes += bytes;
								files.push(file);
							}
						}); // foreach item
						
						// check for end of key list
						if (!data.IsTruncated || !items.length) done = true;
						else {
							// advance to next chunk
							params.StartAfter = items[ items.length - 1 ].Key;
						}
						
						num_calls++;
						callback();
					} )
					.catch( function(err) {
						callback( err );
					} );
			},
			function(err) {
				if (tracker) tracker.end();
				if (err) return process.nextTick( function() { callback(err, null, null); });
				
				self.logDebug(9, "S3 listing complete (" + Tools.commify(files.length) + " objects, " + Tools.getTextFromBytes(total_bytes) + ")", {
					prefix: params.Prefix,
					count: files.length,
					bytes: total_bytes,
					calls: num_calls
				});
				
				// break out of promise context
				process.nextTick( function() { callback( null, files, total_bytes ); } );
			}
		); // whilst
	}
	
	/** 
	 * Recursively walk S3 and fire sync iterator for every file under a given prefix.
	 * @param {Object} opts - The options object for the walk operation.
	 * @param {string} opts.remotePath - The base S3 path to look for files under.
	 * @param {Function} opts.iterator - A synchronous function that is called for every remote S3 file.
	 * @param {RegExp} [opts.filespec] - Optionally filter the result files using a regular expression, matched on the filenames.
	 * @param {Function} [opts.filter] - Optionally provide a filter function to select which files to return.
	 * @param {(number|string)} [opts.older] - Optionally filter the S3 files based on their modification date.
	 * @param {string} [opts.bucket] - Optionally specify the S3 bucket where the folders reside.
	 * @returns {Promise<Object>} - A promise that resolves to a custom object.
	 */
	walk(opts, callback) {
		// fire sync iterator for every file in S3 given prefix
		// this repeatedly calls ListObjectsV2 for lists > 1000
		// opts: { bucket, remotePath, filespec, filter, iterator }
		// result: { }
		let self = this;
		let done = false;
		let num_calls = 0;
		let now = Tools.timeNow(true);
		
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.iterator) return callback( new Error("Missing required 'iterator' (function) property.") );
		if (!opts.remotePath) opts.remotePath = '';
		if (!opts.filespec) opts.filespec = /.*/;
		if (!opts.filter) opts.filter = function() { return true; };
		
		if (opts.older) {
			// convert older to filter func with mtime
			if (typeof(opts.older) == 'string') opts.older = Tools.getSecondsFromText( opts.older );
			opts.filter = function(file) { return file.mtime <= now - opts.older; };
		}
		
		let params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Prefix = this.prefix + opts.remotePath;
		params.MaxKeys = 1000;
		
		this.logDebug(8, "Walking S3 files with prefix: " + params.Prefix, opts);
		let tracker = this.perf ? this.perf.begin('s3_list') : null;
		
		async.whilst(
			function() { 
				return !done; 
			},
			function(callback) {
				self.logDebug(9, "Walking chunk", params);
				
				self.s3.send( new S3.ListObjectsV2Command(params) )
					.then( function(data) {
						let items = data.Contents || [];
						for (let idx = 0, len = items.length; idx < len; idx++) {
							let item = items[idx];
							let key = item.Key;
							let bytes = item.Size;
							let mtime = item.LastModified.getTime() / 1000;
							let file = { key: key, size: bytes, mtime: mtime };
							
							// optional filter and filespec
							if (opts.filter(file) && Path.basename(key).match(opts.filespec)) {
								opts.iterator(file);
							}
						}
						
						// check for end of key list
						if (!data.IsTruncated || !items.length) done = true;
						else {
							// advance to next chunk
							params.StartAfter = items[ items.length - 1 ].Key;
						}
						
						num_calls++;
						callback();
					} )
					.catch( function(err) {
						callback( err );
					} );
			},
			function(err) {
				if (tracker) tracker.end();
				if (err) return process.nextTick( function() { callback(err); });
				
				self.logDebug(9, "S3 walk complete", {
					prefix: params.Prefix,
					calls: num_calls
				});
				
				// break out of promise context
				process.nextTick( function() { callback(null); } );
			}
		); // whilst
	}
	
	/**
	 * Delete a single S3 object.
	 * @param {Object} opts - The options object for the delete operation.
	 * @param {string} opts.key - The key (S3 path) to delete.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @returns {Promise<MetaResponse>} - A promise that resolves to a custom object.
	 */
	delete(opts, callback) {
		// delete s3 object
		// opts: { bucket, key }
		// result: { metadata }
		let self = this;
		if (typeof(opts) == 'string') opts = { key: opts };
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		
		let params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Key = this.prefix + opts.key;
		
		this.logDebug(8, "Deleting S3 Object: " + opts.key, params);
		
		if (opts.dry) {
			this.logDebug(9, "Dry-run, returning faux success");
			return process.nextTick( function() { callback(null, { dry: true }); } );
		}
		
		// also remove from cache if enabled and key present
		if (this.cache && opts.key.match(this.cache.keyMatch) && this.lru.has(opts.key)) {
			this.lru.delete(opts.key);
		}
		
		// NOTE: AWS SDK DeleteObjectCommand does NOT return any error or indication of failure for non-existent keys:
		// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/classes/deleteobjectcommand.html
		// So we have to head() the object first, which is ridiculous but okay.
		
		this.head( opts, function(err, meta) {
			if (err) return callback(err);
			
			let tracker = self.perf ? self.perf.begin('s3_delete') : null;
			self.s3.send( new S3.DeleteObjectCommand(params) )
				.then( function(meta) {
					if (tracker) tracker.end();
					self.logDebug(9, "Delete complete: " + opts.key, meta);
					if (callback) process.nextTick( function() { callback(null, meta); });
				} )
				.catch( function(err) {
					if (tracker) tracker.end();
					self.logError('delete', "Failed to delete object: " + opts.key + ": " + (err.message || err), err);
					if (callback) process.nextTick( function() { callback(err, null); });
				} );
		} ); // head
	}
	
	/**
	 * Upload a single file to S3.
	 * @param {Object} opts - The options object for the uploadFile operation.
	 * @param {string} opts.key - The key (S3 path) to store the file under.
	 * @param {string} opts.localFile - A path to the file on local disk.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {Object} [opts.params] - Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class. 
	 * @param {boolean} [opts.compress=false] - Optionally compress the file during upload.
	 * @param {Function} [opts.progress] - A function to receive progress udpates.
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @returns {Promise<MetaResponse>} - A promise that resolves to a custom object.
	 */
	uploadFile(opts, callback) {
		// upload file to S3 using streams
		// opts: { bucket, key, localFile, params, compress }
		// result: { metadata }
		let self = this;
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		if (!opts.localFile) return callback( new Error("Missing required 'localFile' (string) property.") );
		if (typeof(opts.localFile) != 'string') return callback( new Error("The 'localFile' property must be a string (file path).") );
		if (opts.key.match(/\/$/)) opts.key += Path.basename(opts.localFile); // copy s3 filename from local filename
		
		// auto-detect mime type
		if (!opts.params) opts.params = {};
		if (!opts.params.ContentType) {
			opts.params.ContentType = mime.lookup(opts.localFile) || 'application/octet-stream';
		}
		
		fs.stat( opts.localFile, function(err, stats) {
			if (err) {
				self.logError('file', "Failed to stat local file: " + opts.localFile + ": " + err, err);
				return callback(err);
			}
			
			self.logDebug(8, "Uploading file: " + opts.key + " to: " + opts.key, { file: opts.localFile, key: opts.key, size: stats.size });
			
			if (opts.dry) {
				self.logDebug(9, "Dry-run, returning faux success");
				return process.nextTick( function() { callback(null, { dry: true }); } );
			}
			
			// streamize
			opts.value = fs.createReadStream(opts.localFile);
			
			self.putStream(opts, callback);
		}); // fs.stat
	}
	
	/**
	 * Download an object from S3, and saves it to a local file on disk.
	 * @param {Object} opts - The options object for the downloadFile operation.
	 * @param {string} opts.key - The S3 key of the object to download.
	 * @param {string} opts.localFile - A path to the destination file on local disk.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {boolean} [opts.decompress=false] - Optionally decompress the file during download.
	 * @param {Function} [opts.progress] - A function to receive progress udpates.
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @returns {Promise<MetaResponse>} - A promise that resolves to a custom object.
	 */
	downloadFile(opts, callback) {
		// download file from S3 using streams, save to local fs
		// opts: { bucket, key, localFile, decompress }
		// result: { metadata }
		let self = this;
		if (!opts.localFile) return callback( new Error("Missing required 'localFile' (string) property.") );
		if (typeof(opts.localFile) != 'string') return callback( new Error("The 'localFile' property must be a string (file path).") );
		if (opts.localFile.match(/\/$/)) opts.localFile += Path.basename(opts.key); // copy filename from key
		
		this.logDebug(8, "Downloading file: " + opts.key + " to: " + opts.localFile, { key: opts.key, file: opts.localFile });
		
		if (opts.dry) {
			this.logDebug(9, "Dry-run, returning faux success");
			return process.nextTick( function() { callback(null, { dry: true }); } );
		}
		
		Tools.mkdirp( Path.dirname( Path.resolve(opts.localFile) ), function(err) {
			if (err) {
				self.logError('dir', "Failed to create parent directories for download: " + opts.localFile + ": " + err, err);
				return callback(err);
			}
			
			self.getStream(opts, function(err, inp, meta) {
				if (err) return callback(err);
				
				let done = false;
				let tracker = self.perf ? self.perf.begin('s3_get') : null;
				let outp = fs.createWriteStream(opts.localFile);
				
				inp.on('error', function(err) {
					if (done) return; else done = true;
					if (tracker) tracker.end();
					self.logError('stream', "Read stream failed: " + opts.localFile + ": " + err, err);
					if (callback) callback(err);
				});
				
				outp.on('error', function(err) {
					if (done) return; else done = true;
					if (tracker) tracker.end();
					self.logError('stream', "Write stream failed: " + opts.localFile + ": " + err, err);
					if (callback) callback(err);
				});
				
				outp.on('finish', function() {
					if (done) return; else done = true;
					if (tracker) tracker.end();
					self.logDebug(9, "Download complete: " + opts.key, opts.localFile);
					self.logDebug(9, "File written: " + opts.localFile);
					callback( null, meta );
				});
				
				inp.pipe(outp);
			}); // getStream
		} ); // mkdirp
	}
	
	/**
	 * Recursively uploads multiple files / directories from the local filesystem to S3.
	 * @param {Object} opts - The options object for the uploadFiles operation.
	 * @param {string} opts.localPath - The base filesystem path to find files under.  Should resolve to a folder.
	 * @param {string} opts.remotePath - The base S3 path to store files under.
	 * @param {RegExp} [opts.filespec] - Optionally filter the local files using a regular expression, matched on the filenames.
	 * @param {Function} [opts.filter] - Optionally provide a filter function to select which files to include.
	 * @param {boolean} [opts.all=false] - Optionally include dotfiles (default is no).
	 * @param {number} [opts.threads=1] - Optionally increase the threads to improve performance.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {Object} [opts.params] - Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class. 
	 * @param {boolean} [opts.compress=false] - Optionally compress the files during upload.
	 * @param {string} [opts.suffix] - Optionally append a suffix to every destination S3 key, e.g. `.gz` for compressed files.
	 * @param {Function} [opts.progress] - A function to receive progress udpates.
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @returns {Promise<ListResponse>} - A promise that resolves to a custom object.
	 */
	uploadFiles(opts, callback) {
		// upload multiple files using local fs scan
		// opts: { bucket, remotePath, filespec, threads, localPath, compress, suffix }
		// result: { files[] }
		let self = this;
		
		if (!opts.localPath) opts.localPath = process.cwd();
		opts.localPath = Path.resolve(opts.localPath).replace(/\/$/, '');
		
		if (!opts.remotePath) opts.remotePath = '';
		opts.remotePath = opts.remotePath.replace(/\/$/, '');
		
		this.logDebug(9, "Scanning for local files: " + opts.localPath, opts);
		
		Tools.findFiles( opts.localPath, { ...opts, stats: true }, function(err, files) {
			if (err) {
				self.logError('glob', "Failed to list local files: " + opts.localPath + ": " + (err.message || err), err);
				return callback(err, null);
			}
			
			// calculate total size and setup progress
			var progressHandler = opts.progress || function() {};
			delete opts.progress; // don't pass this down to uploadFile
			var total = 0;
			var loaded = 0;
			files.forEach( function(file) { total += file.size; } );
			
			self.logDebug(8, "Uploading " + files.length + " files (" + Tools.getTextFromBytes(total) + ")", files);
			
			async.eachLimit( files, opts.threads || 1,
				function(file, callback) {
					let dest_key = opts.remotePath + file.path.slice(opts.localPath.length) + (opts.suffix || '');
					
					self.uploadFile( Tools.mergeHashes(opts, { key: dest_key, localFile: file.path }), function(err) {
						if (err) return callback(err);
						
						// update progress
						loaded += file.size;
						progressHandler({ loaded, total });
						
						callback();
					} ); // uploadFile
				},
				function(err) {
					if (err) return callback(err, null);
					self.logDebug(9, "All files uploaded successfully");
					callback(null, files);
				}
			); // eachLimit
		}); // findFiles
	}
	
	/**
	 * Recursively downloads multiple files / directories from S3 to the local filesystem.
	 * @param {Object} opts - The options object for the downloadFiles operation.
	 * @param {string} opts.remotePath - The base S3 path to fetch files from.
	 * @param {string} opts.localPath - The local filesystem path to save files under.
	 * @param {RegExp} [opts.filespec] - Optionally filter the S3 files using a regular expression, matched on the filenames.
	 * @param {Function} [opts.filter] - Optionally provide a filter function to select which files to include.
	 * @param {number} [opts.threads=1] - Optionally increase the threads to improve performance.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {boolean} [opts.decompress=false] - Optionally decompress the files during download.
	 * @param {RegExp} [opts.strip] - Optionally strip a suffix from every destination filename.
	 * @param {Function} [opts.progress] - A function to receive progress udpates.
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @returns {Promise<ListResponse>} - A promise that resolves to a custom object.
	 */
	downloadFiles(opts, callback) {
		// download multiple files using s3 list
		// opts: { bucket, remotePath, filespec, threads, localPath, decompress, strip }
		// result: { files([{ key, size, mtime }, ...]), total_bytes }
		let self = this;
		
		this.list(opts, function(err, files, bytes) {
			if (err) return callback(err, null, null);
			
			// normalize paths
			if (!opts.localPath) opts.localPath = process.cwd();
			opts.localPath = Path.resolve(opts.localPath).replace(/\/$/, '');
			opts.remotePath = opts.remotePath.replace(/\/$/, '');
			
			// setup progress
			var progressHandler = opts.progress || function() {};
			delete opts.progress; // don't pass this down to downloadFile
			var total = bytes;
			var loaded = 0;
			
			self.logDebug(8, "Downloading " + files.length + " files", files);
			
			async.eachLimit( files, opts.threads || 1,
				function(file, callback) {
					let dest_file = opts.localPath + file.key.slice(self.prefix.length + opts.remotePath.length);
					if (opts.strip) dest_file = dest_file.replace(opts.strip, '');
					
					self.downloadFile( Tools.mergeHashes(opts, { key: file.key.slice(self.prefix.length), localFile: dest_file }), function(err) {
						if (err) return callback(err);
						
						// update progress
						loaded += file.size;
						progressHandler({ loaded, total });
						
						callback();
					} ); // downloadFile
				},
				function(err) {
					if (err) return callback(err, null, null);
					self.logDebug(9, "All files downloaded successfully");
					callback(null, files, bytes);
				}
			); // eachLimit
		}); // list
	}
	
	/** 
	 * Recursively deletes multiple files / directories from S3.
	 * @param {Object} opts - The options object for the list operation.
	 * @param {string} opts.remotePath - The base S3 path to delete files from.
	 * @param {RegExp} [opts.filespec] - Optionally filter the S3 files using a regular expression, matched on the filenames.
	 * @param {Function} [opts.filter] - Optionally provide a filter function to select which files to include.
	 * @param {(number|string)} [opts.older] - Optionally filter the S3 files based on their modification date.
	 * @param {number} [opts.threads=1] - Optionally increase the threads to improve performance.
	 * @param {string} [opts.bucket] - Optionally specify the S3 bucket where the folders reside.
	 * @param {Function} [opts.progress] - A function to receive progress udpates.
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @returns {Promise<ListResponse>} - A promise that resolves to a custom object.
	 */
	deleteFiles(opts, callback) {
		// delete multiple files using s3 list
		// opts: { bucket, remotePath, filespec, threads }
		// result: { files([{ key, size, mtime }, ...]), total_bytes }
		let self = this;
		
		this.list(opts, function(err, files, bytes) {
			if (err) return callback(err, null, null);
			
			// setup progress
			var progressHandler = opts.progress || function() {};
			delete opts.progress; // don't pass this down to delete
			var total = bytes;
			var loaded = 0;
			
			self.logDebug(8, "Deleting " + files.length + " files", files);
			
			async.eachLimit( files, opts.threads || 1,
				function(file, callback) {
					self.delete( Tools.mergeHashes(opts, { key: file.key.slice(self.prefix.length) }), function(err) {
						if (err) return callback(err);
						
						// update progress
						loaded += file.size;
						progressHandler({ loaded, total });
						
						callback();
					}); // delete
				},
				function(err) {
					if (err) return callback(err, null, null);
					self.logDebug(9, "All files deleted successfully");
					callback(null, files, bytes);
				}
			); // eachLimit
		}); // list
	}
	
	/**
	 * Upload a Node.js Buffer object to S3, given a key.
	 * @param {Object} opts - The options object for the putBuffer operation.
	 * @param {string} opts.key - The key (S3 path) to store the object under.
	 * @param {Buffer} opts.value - The Buffer to store as the object content.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {Object} [opts.params] - Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class. 
	 * @param {boolean} [opts.compress=false] - Optionally compress the buffer during upload.
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @param {Function} [opts.progress] - A function to receive progress udpates.
	 * @returns {Promise<MetaResponse>} - A promise that resolves to a custom object.
	 */
	putBuffer(opts, callback) {
		// upload buffer object to S3
		// opts: { bucket, key, value, params, compress }
		// result: { metadata }
		let self = this;
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		if (!opts.value) return callback( new Error("Missing required 'value' (Buffer) property.") );
		if (!Buffer.isBuffer(opts.value)) return callback( new Error("The 'value' property must be a buffer object.") );
		
		this.logDebug(9, "Storing Buffer: " + opts.key + ' (' + opts.value.length + ' bytes)', opts.params);
		
		if (opts.dry) {
			this.logDebug(9, "Dry-run, returning faux success");
			return process.nextTick( function() { callback(null, { dry: true }); } );
		}
		
		// convert buffer to stream
		let buf = opts.value;
		opts.value = Readable.from(buf);
		
		this.putStream(opts, callback);
	}
	
	/**
	 * Fetch an S3 object, and return a Node.js Buffer.
	 * @param {Object} opts - The options object for the get operation.
	 * @param {string} opts.key - The key (S3 path) to fetch.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {boolean} [opts.decompress=false] - Optionally decompress the buffer during download.
	 * @param {Function} [opts.progress] - A function to receive progress udpates.
	 * @returns {Promise<GetResponse>} - A promise that resolves to a custom object.
	 */
	getBuffer(opts, callback) {
		// fetch buffer from S3 (must convert from stream)
		// opts: { bucket, key, decompress }
		// result: { buffer, metadata }
		let self = this;
		if (typeof(opts) == 'string') opts = { key: opts };
		
		this.getStream( opts, function(err, inp, data) {
			if (err) return callback(err);
			
			// stream to buffer
			self.logDebug(9, "Converting stream to buffer: " + opts.key);
			
			streamToBuffer( inp, function (err, body) {
				if (err) {
					self.logError('get', "Failed to fetch key: " + opts.key + ": " + (err.message || err), err);
					return callback( err, null, null );
				}
				
				self.logDebug(9, "Fetch complete: " + opts.key, '' + body.length + ' bytes');
				callback( null, body, data );
			} ); // streamToBuffer
		} ); // getStream
	}
	
	/**
	 * Uploads a Node.js Stream to S3, given a key.
	 * @param {Object} opts - The options object for the putStream operation.
	 * @param {string} opts.key - The key (S3 path) to store the object under.
	 * @param {Object} opts.value - The Stream to store as the object content.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {Object} [opts.params] - Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class. 
	 * @param {boolean} [opts.compress=false] - Optionally compress the stream during upload.
	 * @param {boolean} [opts.dry=false] - Optionally do a dry run (take no action).
	 * @param {Function} [opts.progress] - A function to receive progress udpates.
	 * @returns {Promise<MetaResponse>} - A promise that resolves to a custom object.
	 */
	putStream(opts, callback) {
		// upload stream to S3 as multipart
		// opts: { bucket, key, value, params, compress }
		// result: { metadata }
		let self = this;
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		if (!opts.value) return callback( new Error("Missing required 'value' (stream) property.") );
		if (!isStream(opts.value)) return callback( new Error("The 'value' property must be a stream object.") );
		
		let params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Key = this.prefix + opts.key;
		
		// if S3 Metadata is provided, all keys MUST be strings (limitation of S3 / AWS-SDK)
		if (params.Metadata) {
			for (let key in params.Metadata) {
				params.Metadata[key] = '' + params.Metadata[key];
			}
		}
		
		this.logDebug(9, "Storing Stream: " + opts.key, params);
		
		if (opts.dry) {
			this.logDebug(9, "Dry-run, returning faux success");
			return process.nextTick( function() { callback(null, { dry: true }); } );
		}
		
		if (opts.compress) {
			self.logDebug(9, "Compressing stream with gzip");
			let gzip = zlib.createGzip( opts.gzip || self.gzip || {} );
			let inp = opts.value;
			inp.pipe(gzip);
			params.Body = gzip;
		}
		else {
			params.Body = opts.value;
		}
		
		let tracker = this.perf ? this.perf.begin('s3_put') : null;
		let upload = new Upload({
			client: this.s3,
			params: params
		});
		
		if (opts.progress) {
			// { loaded, total }
			upload.on('httpUploadProgress', opts.progress);
		}
		
		upload.done()
			.then( function(data) {
				if (tracker) tracker.end();
				self.logDebug(9, "Store complete: " + opts.key);
				if (callback) process.nextTick( function() { callback(null, data); });
			} )
			.catch( function(err) {
				if (tracker) tracker.end();
				self.logError('put', "Failed to store S3 object: " + opts.key + ": " + (err.message || err), err);
				if (callback) process.nextTick( function() { callback(err, null); });
			} );
	}
	
	/**
	 * Fetch an S3 object, and returns a Node.js readable stream.
	 * @param {Object} opts - The options object for the getStream operation.
	 * @param {string} opts.key - The key (S3 path) to fetch.
	 * @param {string} [opts.bucket] - Optionally override the S3 bucket.
	 * @param {boolean} [opts.decompress=false] - Optionally decompress the stream during download.
	 * @param {Function} [opts.progress] - A function to receive progress udpates.
	 * @returns {Promise<GetResponse>} - A promise that resolves to a custom object.
	 */
	getStream(opts, callback) {
		// fetch stream from S3
		// opts: { bucket, key, decompress }
		// result: { stream, metadata }
		let self = this;
		if (typeof(opts) == 'string') opts = { key: opts };
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		
		let params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Key = this.prefix + opts.key;
		
		this.logDebug(9, "Fetching stream: " + opts.key, params);
		
		let tracker = this.perf ? this.perf.begin('s3_get') : null;
		this.s3.send( new S3.GetObjectCommand(params) )
			.then( function(data) {
				// break out of promise context
				process.nextTick( function() {
					if (tracker) tracker.end();
					var count = 0;
					var len = parseInt( data.ContentLength || 0 );
					self.logDebug(9, "Stream started: " + opts.key, { size: len });
					
					if (opts.progress) {
						data.Body.on('data', function(chunk) {
							count += chunk.length;
							opts.progress({ loaded: count, total: len });
						});
					}
					
					if (opts.decompress) {
						self.logDebug(9, "Decompressing stream with gunzip");
						let gzip = zlib.createGunzip();
						gzip.on('error', function(err) {
							self.logError('gzip', "Gzip Decompress Error: " + opts.key + ": " + (err.message || err));
						});
						data.Body.pipe(gzip);
						callback( null, gzip, data );
					}
					else {
						callback( null, data.Body, data );
					}
				}); // nextTick
			} )
			.catch( function(err) {
				if (tracker) tracker.end();
				if ((err.name == 'NoSuchKey') || (err.name == 'NotFound') || (err.code == 'NoSuchKey') || (err.code == 'NotFound')) {
					// key not found, special case, don't log an error
					// always include "Not found" in error message
					err = new Error("Failed to fetch key: " + opts.key + ": Not found");
					err.code = "NoSuchKey";
				}
				else {
					// some other error
					self.logError('get', "Failed to fetch key: " + opts.key + ": " + (err.message || err), err);
				}
				process.nextTick( function() { callback( err, null, null ); });
			} );
	}
	
	/** 
	 * @typedef {Object} ListBucketsResponse
	 * @property {string[]} buckets - Array of S3 bucket names.
	 */
	
	/**
	 * Fetch the complete list of S3 buckets in your AWS account.
	 * @returns {Promise<ListBucketsResponse>} - A promise that resolves to a custom object.
	 */
	listBuckets(callback) {
		// list buckets -- no options
		// result: { buckets }
		let self = this;
		let opts = {};
		let params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		
		this.logDebug(8, "Listing buckets", opts);
		let tracker = this.perf ? this.perf.begin('s3_list') : null;
		
		this.s3.send( new S3.ListBucketsCommand(params) )
			.then( function(data) {
				if (tracker) tracker.end();
				
				let buckets = (data.Buckets || []).map( function(item) { 
					return item.Name; 
				} );
				
				self.logDebug(9, "S3 bucket listing complete (" + buckets.length + " buckets)");
				
				// break out of promise context
				process.nextTick( function() { callback( null, buckets ); } );
			} )
			.catch( function(err) {
				if (tracker) tracker.end();
				
				// break out of promise context
				return process.nextTick( function() { callback( err, null ); });
			} );
	}
	
	/** 
	 * Log a debug message to the attached log agent.
	 * @private
	 * @param {number} level - The log level of the debug message.
	 * @param {string} msg - The message text to log.
	 * @param {Object} [data] - Optional data to accompany the log message.
	 */
	logDebug(level, msg, data) {
		// log a debug message
		if (this.logger) {
			if (this.logger.set) this.logger.set('component', 'S3');
			this.logger.debug(level, msg, data);
		}
	}
	
	/** 
	 * Log an error to the attached log agent.
	 * @private
	 * @param {(number|string)} code - The error code to log.
	 * @param {string} msg - The error message text to log.
	 * @param {Object} [data] - Optional data to accompany the log message.
	 */
	logError(code, msg, data) {
		// log an error message
		if (this.logger) {
			if (this.logger.set) this.logger.set('component', 'S3');
			this.logger.error( 'err_s3_' + code, msg, data );
		}
	}
	
}; // class S3API

asyncify( S3API, {
	put: ['meta'],
	get: ['data', 'meta'],
	update: ['data', 'meta'],
	head: ['meta'],
	listFolders: ['folders', 'files'],
	list: ['files', 'bytes'],
	walk: [],
	copy: ['meta'],
	copyFiles: ['meta'],
	move: ['meta'],
	moveFiles: ['meta'],
	delete: ['meta'],
	uploadFile: ['meta'],
	downloadFile: ['meta'],
	uploadFiles: ['files'],
	downloadFiles: ['files', 'bytes'],
	deleteFiles: ['files', 'bytes'],
	putBuffer: ['meta'],
	getBuffer: ['data', 'meta'],
	putStream: ['meta'],
	getStream: ['data', 'meta'],
	listBuckets: ['buckets']
} );

module.exports = S3API;

/** 
 * Use duck typing to sniff if variable is a stream
 * @param {*} stream - The variable to sniff.
 * @returns {boolean} - The result of the sniff.
 */
function isStream(stream) {
	// use duck typing to sniff if variable is a stream
	// from: https://github.com/sindresorhus/is-stream
	return stream !== null
		&& typeof stream === 'object'
		&& typeof stream.pipe === 'function';
};
