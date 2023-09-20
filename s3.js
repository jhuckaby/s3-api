// Simple wrapper around AWS S3 API v3
// Copyright (c) 2023 Joseph Huckaby, MIT License

const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const Path = require('path');
const Class = require('class-plus');
const Tools = require('pixl-tools');
const LRU = require('pixl-cache');
const { Readable } = require('stream');
const streamToBuffer = require("fast-stream-to-buffer");

const S3 = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { NodeHttpHandler } = require("@smithy/node-http-handler");

const async = Tools.async;

module.exports = Class({
	__asyncify: {
		put: ['meta'],
		get: ['data', 'meta'],
		head: ['meta'],
		listFolders: ['folders', 'files'],
		list: ['files', 'bytes'],
		walk: [],
		copy: ['meta'],
		move: ['meta'],
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
	},
	
	region: 'us-west-1',
	bucket: '',
	prefix: '',
	params: null,
	retries: 50,
	timeout: 5000,
	connectTimeout: 5000,
	logger: null,
	perf: null,
	gzip: {}
}, 
class S3API {
	
	constructor(args = {}) {
		// optional: { credentials, region, bucket, prefix, params, timeout, connectTimeout, retries, logger, perf, gzip, cache }
		Tools.mergeHashInto(this, args);
		
		var opts = {
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
	
	setupCache() {
		// setup caching layer using pixl-cache
		var self = this;
		if (typeof(this.cache) != 'object') this.cache = {};
		if (!this.cache.keyMatch) this.cache.keyMatch = /.+/;
		
		this.lru = new LRU( this.cache );
		this.lru.on( 'expire', function(item, reason) {
			self.logDebug(9, `Cache expired ${item.key} because of ${reason}.`);
		});
	}
	
	attachLogAgent(agent) {
		// attach a pixl-logger compatible agent for debug logging
		this.logger = agent;
	}
	attachPerfAgent(perf) {
		// attach a pixl-perf compatible agent for perf tracking
		this.perf = perf;
	}
	
	put(opts, callback) {
		// serialize object to JSON and store as buffer
		// opts: { bucket, key, value, pretty, params }
		// result: { metadata }
		var self = this;
		if (!opts.value) return callback( new Error("Missing required 'value' (object) property.") );
		if (typeof(opts.value) != 'object') return callback( new Error("The 'value' property must be an object.") );
		if (Buffer.isBuffer(opts.value)) return callback( new Error("The 'value' property must be an object (not a Buffer).") );
		
		this.logDebug(8, "Storing JSON record: " + opts.key, Tools.copyHashRemoveKeys(opts, { value:1 }));
		
		// serialize and bufferize
		var orig_value = opts.value;
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
	
	get(opts, callback) {
		// fetch buffer from S3 and parse as JSON
		// opts: { bucket, key }
		// result: { json, metadata }
		var self = this;
		if (typeof(opts) == 'string') opts = { key: opts };
		
		if (this.cache && opts.key.match(this.cache.keyMatch)) {
			// chceck if item is in cache
			var value = this.lru.get(opts.key);
			if (value) {
				// item is in cache and still fresh, use it
				this.logDebug(8, "Using JSON record from cache: " + opts.key, opts);
				return process.nextTick( function() { callback( null, value, { cached: true } ); } );
			}
		}
		
		this.logDebug(8, "Fetching JSON record: " + opts.key, opts);
		
		this.getBuffer(opts, function(err, buf, meta) {
			if (err) return callback(err);
			
			var json = null;
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
			callback( null, json, meta );
		});
	}
	
	head(opts, callback) {
		// see if object exists, and get its size & mod date
		// opts: { bucket, key, nonfatal }
		// result: { meta(size, mtime) }
		var self = this;
		if (typeof(opts) == 'string') opts = { key: opts };
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		
		var params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Key = this.prefix + opts.key;
		
		this.logDebug(8, "Pinging key: " + opts.key, params);
		
		var tracker = this.perf ? this.perf.begin('s3_head') : null;
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
	
	copy(opts, callback) {
		// copy a single object from one location to another
		// opts: { sourceBucket, sourceKey, bucket, key, params }
		// result: { metadata }
		var self = this;
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.sourceBucket) opts.sourceBucket = this.bucket;
		if (!opts.sourceBucket) return callback( new Error("Missing required 'sourceBucket' (string) property.") );
		if (!opts.sourceKey) return callback( new Error("Missing required 'sourceKey' (string) property.") );
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		
		var params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.CopySource = opts.sourceBucket + '/' + this.prefix + opts.sourceKey;
		params.Bucket = opts.bucket;
		params.Key = this.prefix + opts.key;
		
		this.logDebug(8, "Copying object: " + opts.sourceKey + " to: " + opts.key, params);
		
		var tracker = this.perf ? this.perf.begin('s3_copy') : null;
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
	
	move(opts, callback) {
		// move a single object from one location to another
		// opts: { sourceBucket, sourceKey, bucket, key, params }
		// result: { metadata }
		var self = this;
		
		this.copy(opts, function(err) {
			if (err) return callback(err);
			
			// now delete the source
			self.delete({ bucket: opts.sourceBucket || self.bucket, key: opts.sourceKey }, callback);
		});
	}
	
	listFolders(opts, callback) {
		// list only subfolders from a start path -- single level and no pagination
		// opts: { bucket, remotePath, delimiter }
		// result: { folders, files }
		var self = this;
		
		if (typeof(opts) == 'string') opts = { remotePath: opts };
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.remotePath) opts.remotePath = '';
		
		var params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Prefix = this.prefix + opts.remotePath;
		params.MaxKeys = 1000;
		params.Delimiter = opts.delimiter || '/';
		
		this.logDebug(8, "Listing S3 subfolders with prefix: " + params.Prefix, opts);
		var tracker = this.perf ? this.perf.begin('s3_list') : null;
		
		this.s3.send( new S3.ListObjectsV2Command(params) )
			.then( function(data) {
				if (tracker) tracker.end();
				
				var folders = (data.CommonPrefixes || []).map( function(item) { 
					return item.Prefix; 
				} );
				
				var files = (data.Contents || []).map( function(item) {
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
	
	list(opts, callback) {
		// generate list of objects in S3 given prefix
		// this repeatedly calls ListObjectsV2 for lists > 1000
		// opts: { bucket, remotePath, filespec, filter }
		// result: { files([{ key, size, mtime }, ...]), total_bytes }
		var self = this;
		var done = false;
		var files = [];
		var total_bytes = 0;
		var num_calls = 0;
		var now = Tools.timeNow(true);
		
		if (typeof(opts) == 'string') opts = { remotePath: opts };
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
		
		var params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Prefix = this.prefix + opts.remotePath;
		params.MaxKeys = 1000;
		
		this.logDebug(8, "Listing S3 files with prefix: " + params.Prefix, opts);
		var tracker = this.perf ? this.perf.begin('s3_list') : null;
		
		async.whilst(
			function() { 
				return !done; 
			},
			function(callback) {
				self.logDebug(9, "Listing chunk", params);
				
				self.s3.send( new S3.ListObjectsV2Command(params) )
					.then( function(data) {
						var items = data.Contents || [];
						for (var idx = 0, len = items.length; idx < len; idx++) {
							var item = items[idx];
							var key = item.Key;
							var bytes = item.Size;
							var mtime = item.LastModified.getTime() / 1000;
							var file = { key: key, size: bytes, mtime: mtime };
							
							// optional filter and filespec
							if (opts.filter(file) && Path.basename(key).match(opts.filespec)) {
								total_bytes += bytes;
								files.push(file);
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
	
	walk(opts, callback) {
		// fire sync iterator for every file in S3 given prefix
		// this repeatedly calls ListObjectsV2 for lists > 1000
		// opts: { bucket, remotePath, filespec, filter, iterator }
		// result: { }
		var self = this;
		var done = false;
		var num_calls = 0;
		var now = Tools.timeNow(true);
		
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
		
		var params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Prefix = this.prefix + opts.remotePath;
		params.MaxKeys = 1000;
		
		this.logDebug(8, "Walking S3 files with prefix: " + params.Prefix, opts);
		var tracker = this.perf ? this.perf.begin('s3_list') : null;
		
		async.whilst(
			function() { 
				return !done; 
			},
			function(callback) {
				self.logDebug(9, "Walking chunk", params);
				
				self.s3.send( new S3.ListObjectsV2Command(params) )
					.then( function(data) {
						var items = data.Contents || [];
						for (var idx = 0, len = items.length; idx < len; idx++) {
							var item = items[idx];
							var key = item.Key;
							var bytes = item.Size;
							var mtime = item.LastModified.getTime() / 1000;
							var file = { key: key, size: bytes, mtime: mtime };
							
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
	
	delete(opts, callback) {
		// delete s3 object
		// opts: { bucket, key }
		// result: { metadata }
		var self = this;
		if (typeof(opts) == 'string') opts = { key: opts };
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		
		var params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Key = this.prefix + opts.key;
		
		this.logDebug(8, "Deleting S3 Object: " + opts.key, params);
		
		// also remove from cache if enabled and key present
		if (this.cache && opts.key.match(this.cache.keyMatch) && this.lru.has(opts.key)) {
			this.lru.delete(opts.key);
		}
		
		// NOTE: AWS SDK DeleteObjectCommand does NOT return any error or indication of failure for non-existent keys:
		// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/classes/deleteobjectcommand.html
		// So we have to head() the object first, which is ridiculous but okay.
		
		this.head( opts, function(err, meta) {
			if (err) return callback(err);
			
			var tracker = self.perf ? self.perf.begin('s3_delete') : null;
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
	
	uploadFile(opts, callback) {
		// upload file to S3 using streams
		// opts: { bucket, key, localFile, params, compress }
		// result: { metadata }
		var self = this;
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		if (!opts.localFile) return callback( new Error("Missing required 'localFile' (string) property.") );
		if (typeof(opts.localFile) != 'string') return callback( new Error("The 'localFile' property must be a string (file path).") );
		if (opts.key.match(/\/$/)) opts.key += Path.basename(opts.localFile); // copy s3 filename from local filename
		
		fs.stat( opts.localFile, function(err, stats) {
			if (err) {
				self.logError('file', "Failed to stat local file: " + opts.localFile + ": " + err, err);
				return callback(err);
			}
			
			self.logDebug(8, "Uploading file: " + opts.key, { file: opts.localFile, size: stats.size });
			
			// streamize
			opts.value = fs.createReadStream(opts.localFile);
			
			self.putStream(opts, callback);
		}); // fs.stat
	}
	
	downloadFile(opts, callback) {
		// download file from S3 using streams, save to local fs
		// opts: { bucket, key, localFile, decompress }
		// result: { metadata }
		var self = this;
		if (!opts.localFile) return callback( new Error("Missing required 'localFile' (string) property.") );
		if (typeof(opts.localFile) != 'string') return callback( new Error("The 'localFile' property must be a string (file path).") );
		if (opts.localFile.match(/\/$/)) opts.localFile += Path.basename(opts.key); // copy filename from key
		
		this.logDebug(8, "Downloading file: " + opts.key, { file: opts.localFile });
		
		Tools.mkdirp( Path.dirname( Path.resolve(opts.localFile) ), function(err) {
			if (err) {
				self.logError('dir', "Failed to create parent directories for download: " + opts.localFile + ": " + err, err);
				return callback(err);
			}
			
			self.getStream(opts, function(err, inp, meta) {
				if (err) return callback(err);
				
				var done = false;
				var tracker = self.perf ? self.perf.begin('s3_get') : null;
				var outp = fs.createWriteStream(opts.localFile);
				
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
					callback( null, meta );
				});
				
				inp.pipe(outp);
			}); // getStream
		} ); // mkdirp
	}
	
	uploadFiles(opts, callback) {
		// upload multiple files using local fs scan
		// opts: { bucket, remotePath, filespec, threads, localPath, compress, suffix }
		// result: { files[] }
		var self = this;
		if (!opts.localPath) opts.localPath = process.cwd();
		opts.localPath = Path.resolve(opts.localPath);
		if (!opts.remotePath) opts.remotePath = '';
		
		this.logDebug(9, "Scanning for local files: " + opts.localPath, opts);
		
		Tools.findFiles( opts.localPath, opts, function(err, files) {
			if (err) {
				self.logError('glob', "Failed to list local files: " + opts.localPath + ": " + (err.message || err), err);
				return callback(err, null);
			}
			
			self.logDebug(8, "Uploading " + files.length + " files", files);
			
			async.eachLimit( files, opts.threads || 1,
				function(file, callback) {
					var dest_key = opts.remotePath + file.slice(opts.localPath.length) + (opts.suffix || '');
					self.uploadFile( Tools.mergeHashes(opts, { key: dest_key, localFile: file }), callback );
				},
				function(err) {
					if (err) return callback(err, null);
					callback(null, files);
				}
			); // eachLimit
		}); // findFiles
	}
	
	downloadFiles(opts, callback) {
		// download multiple files using s3 list
		// opts: { bucket, remotePath, filespec, threads, localPath, decompress, strip }
		// result: { files([{ key, size, mtime }, ...]), total_bytes }
		var self = this;
		if (!opts.localPath) opts.localPath = process.cwd();
		opts.localPath = Path.resolve(opts.localPath);
		
		this.list(opts, function(err, files, bytes) {
			if (err) return callback(err, null, null);
			
			self.logDebug(8, "Downloading " + files.length + " files", files);
			
			async.eachLimit( files, opts.threads || 1,
				function(file, callback) {
					var dest_file = opts.localPath + file.key.slice(self.prefix.length + opts.remotePath.length);
					if (opts.strip) dest_file = dest_file.replace(opts.strip, '');
					self.downloadFile( Tools.mergeHashes(opts, { key: file.key.slice(self.prefix.length), localFile: dest_file }), callback );
				},
				function(err) {
					if (err) return callback(err, null, null);
					callback(null, files, bytes);
				}
			); // eachLimit
		}); // list
	}
	
	deleteFiles(opts, callback) {
		// delete multiple files using s3 list
		// opts: { bucket, remotePath, filespec, threads }
		// result: { files([{ key, size, mtime }, ...]), total_bytes }
		var self = this;
		
		this.list(opts, function(err, files, bytes) {
			if (err) return callback(err, null, null);
			
			async.eachLimit( files, opts.threads || 1,
				function(file, callback) {
					self.delete( Tools.mergeHashes(opts, { key: file.key.slice(self.prefix.length) }), callback);
				},
				function(err) {
					if (err) return callback(err, null, null);
					callback(null, files, bytes);
				}
			); // eachLimit
		}); // list
	}
	
	putBuffer(opts, callback) {
		// upload buffer object to S3
		// opts: { bucket, key, value, params, compress }
		// result: { metadata }
		var self = this;
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		if (!opts.value) return callback( new Error("Missing required 'value' (Buffer) property.") );
		if (!Buffer.isBuffer(opts.value)) return callback( new Error("The 'value' property must be a buffer object.") );
		
		this.logDebug(9, "Storing Buffer: " + opts.key + ' (' + opts.value.length + ' bytes)', opts.params);
		
		// convert buffer to stream
		var buf = opts.value;
		opts.value = Readable.from(buf);
		
		this.putStream(opts, callback);
	}
	
	getBuffer(opts, callback) {
		// fetch buffer from S3 (must convert from stream)
		// opts: { bucket, key, decompress }
		// result: { buffer, metadata }
		var self = this;
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
	
	putStream(opts, callback) {
		// upload stream to S3 as multipart
		// opts: { bucket, key, value, params, compress }
		// result: { metadata }
		var self = this;
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		if (!opts.value) return callback( new Error("Missing required 'value' (stream) property.") );
		if (!isStream(opts.value)) return callback( new Error("The 'value' property must be a stream object.") );
		
		var params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Key = this.prefix + opts.key;
		
		this.logDebug(9, "Storing Stream: " + opts.key, params);
		
		if (opts.compress) {
			self.logDebug(9, "Compressing stream with gzip");
			var gzip = zlib.createGzip( opts.gzip || self.gzip || {} );
			var inp = opts.value;
			inp.pipe(gzip);
			params.Body = gzip;
		}
		else {
			params.Body = opts.value;
		}
		
		var tracker = this.perf ? this.perf.begin('s3_put') : null;
		let upload = new Upload({
			client: this.s3,
			params: params
		});
		
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
	
	getStream(opts, callback) {
		// fetch stream from S3
		// opts: { bucket, key, decompress }
		// result: { stream, metadata }
		var self = this;
		if (typeof(opts) == 'string') opts = { key: opts };
		if (!opts.bucket) opts.bucket = this.bucket;
		if (!opts.bucket) return callback( new Error("Missing required 'bucket' (string) property.") );
		if (!opts.key) return callback( new Error("Missing required 'key' (string) property.") );
		
		var params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		params.Bucket = opts.bucket;
		params.Key = this.prefix + opts.key;
		
		this.logDebug(9, "Fetching stream: " + opts.key, params);
		
		var tracker = this.perf ? this.perf.begin('s3_get') : null;
		this.s3.send( new S3.GetObjectCommand(params) )
			.then( function(data) {
				// break out of promise context
				process.nextTick( function() {
					if (tracker) tracker.end();
					self.logDebug(9, "Stream started: " + opts.key);
					
					if (opts.decompress) {
						self.logDebug(9, "Decompressing stream with gunzip");
						var gzip = zlib.createGunzip();
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
	
	listBuckets(callback) {
		// list buckets -- no options
		// result: { buckets }
		var self = this;
		var opts = {};
		var params = Tools.mergeHashes( this.params || {}, opts.params || {} );
		
		this.logDebug(8, "Listing buckets", opts);
		var tracker = this.perf ? this.perf.begin('s3_list') : null;
		
		this.s3.send( new S3.ListBucketsCommand(params) )
			.then( function(data) {
				if (tracker) tracker.end();
				
				var buckets = (data.Buckets || []).map( function(item) { 
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
	
	logDebug(level, msg, data) {
		// log a debug message
		if (this.logger) {
			if (this.logger.set) this.logger.set('component', 'S3');
			this.logger.debug(level, msg, data);
		}
	}
	
	logError(code, msg, data) {
		// log an error message
		if (this.logger) {
			if (this.logger.set) this.logger.set('component', 'S3');
			this.logger.error( 'err_s3_' + code, msg, data );
		}
	}
	
}); // class S3API

///
// Utilities:
///

function isStream(stream) {
	// use duck typing to sniff if variable is a stream
	// from: https://github.com/sindresorhus/is-stream
	return stream !== null
		&& typeof stream === 'object'
		&& typeof stream.pipe === 'function';
};
