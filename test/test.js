// Unit tests for S3 API
// Use `npm test` to run

const fs = require('fs');
const Tools = require('pixl-tools');
const S3 = require('..');

process.chdir( __dirname );

const LOG_FILE = 'unit.log';
if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);

if (!process.env.S3API_TEST_BUCKET) {
	console.error("\nERROR: Must set S3API_TEST_BUCKET environment variable to run unit tests.");
	console.error("You may also need to set S3API_TEST_REGION, S3API_TEST_ACCESSKEYID and/or S3API_TEST_SECRETACCESSKEY.\n");
	process.exit(1);
}

const config = {
	bucket: process.env.S3API_TEST_BUCKET,
	region: process.env.S3API_TEST_REGION || 'us-west-1',
	prefix: 'test/s3apiunit/' + process.pid + '/',
	logger: {
		set: function() {},
		debug: function(level, msg, data) { 
			fs.appendFileSync(LOG_FILE, "\n" + msg + "\n"); 
			if (data) fs.appendFileSync(LOG_FILE, JSON.stringify(data) + "\n");
		},
		error: function(code, msg, data) {
			fs.appendFileSync(LOG_FILE, "\nERROR " + code + ": " + msg + "\n"); 
			if (data) fs.appendFileSync(LOG_FILE, JSON.stringify(data) + "\n");
		}
	}
};

if (process.env.S3API_TEST_ACCESSKEYID) {
	if (!config.credentials) config.credentials = {};
	config.credentials.accessKeyId = process.env.S3API_TEST_ACCESSKEYID;
}
if (process.env.S3API_TEST_SECRETACCESSKEY) {
	if (!config.credentials) config.credentials = {};
	config.credentials.secretAccessKey = process.env.S3API_TEST_SECRETACCESSKEY;
}

const s3 = new S3(config);

exports.tests = [
	
	async function testListBuckets(test) {
		let { buckets } = await s3.listBuckets();
		test.ok( !!buckets, "buckets is defined" );
		test.ok( !!buckets.length, "buckets array has non-zero length" );
		test.ok( buckets.includes(config.bucket), "Bucket list does not contain " + config.bucket );
		test.done();
	},
	
	async function testPutJSON(test) {
		let { meta } = await s3.put({ key: 'test1.json', value: { hello: 'there' } });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.done();
	},
	
	async function testGetJSON(test) {
		let { data, meta } = await s3.get({ key: 'test1.json' });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.ok( !!data, "data is defined" );
		test.ok( !!data.hello, "data.hello is defined" );
		test.ok( data.hello === "there", "data.hello expected to be there, got: " + data.hello );
		test.done();
	},
	
	async function testReplaceJSON(test) {
		let { meta } = await s3.put({ key: 'test1.json', value: { hello: 'there2', color: 'cyan', animal: 'frog' } });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		
		// recheck contents
		let { data } = await s3.get({ key: 'test1.json' });
		
		test.ok( !!data, "data is defined" );
		test.ok( !!data.hello, "data.hello is defined" );
		test.ok( data.hello === "there2", "data.hello expected to be there2, got: " + data.hello );
		test.ok( data.color === "cyan", "data.color expected to be cyan, got: " + data.color );
		test.ok( data.animal === "frog", "data.animal expected to be frog, got: " + data.animal );
		test.done();
	},
	
	async function testCopyObject(test) {
		let { meta } = await s3.copy({ sourceKey: 'test1.json', key: 'test2.json' });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		
		// check contents
		let { data } = await s3.get({ key: 'test2.json' });
		
		test.ok( !!data, "data is defined" );
		test.ok( !!data.hello, "data.hello is defined" );
		test.ok( data.hello === "there2", "data.hello expected to be there2, got: " + data.hello );
		test.done();
	},
	
	async function testUpdateJSON(test) {
		let { meta } = await s3.update({ key: 'test1.json', updates: { hello: 'there3', color: undefined, sound: 'oof', "obj1.hello": "there4" } });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		
		// recheck contents
		let { data } = await s3.get({ key: 'test1.json' });
		
		test.ok( !!data, "data is defined" );
		test.ok( !!data.hello, "data.hello is defined" );
		test.ok( data.hello === "there3", "data.hello expected to be there3, got: " + data.hello ); // replaced
		test.ok( data.animal === "frog", "data.animal expected to be frog, got: " + data.animal ); // untouched
		test.ok( !("color" in data), "data.color expected to be missing, but is still present: " + data.color ); // deleted
		test.ok( data.sound === "oof", "data.sound expected to be oof, got: " + data.sound ); // added
		test.ok( !!data.obj1, "data.obj1 expected, but is missing" ); // object
		test.ok( typeof(data.obj1) === 'object', "data.obj1 type expected to be object, got: " + typeof(data.obj1) ); // obj type
		test.ok( data.obj1.hello === 'there4', "data.obj1.hello expected to be there4, got: " + data.obj1.hello ); // sub-prop nested
		test.done();
	},
	
	async function testMoveObject(test) {
		let { meta } = await s3.move({ sourceKey: 'test2.json', key: 'test3.json' });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		
		// check contents
		let { data } = await s3.get({ key: 'test3.json' });
		
		test.ok( !!data, "data is defined" );
		test.ok( !!data.hello, "data.hello is defined" );
		test.ok( data.hello === "there2", "data.hello expected to be there2, got: " + data.hello );
		
		// make sure test2.json is deleted
		var err = null;
		try { await s3.head({ key: 'test2.json' }); }
		catch(e) { err = e; }
		
		test.ok( !!err, "Expected error for get non-existent key (test2.json)" );
		test.ok( err.code == "NoSuchKey", "Expected error code to be NoSuchKey, got: " + err.code );
		test.done();
	},
	
	async function testDeleteCopiedMovedRecord(test) {
		let { meta } = await s3.delete({ key: 'test3.json' });
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.done();
	},
	
	async function testPutBuffer(test) {
		let orig = fs.readFileSync( 'spacer.gif' );
		let { meta } = await s3.putBuffer({ key: 'buf.bin', value: orig });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.done();
	},
	
	async function testGetBuffer(test) {
		let orig = fs.readFileSync( 'spacer.gif' );
		let { data, meta } = await s3.getBuffer({ key: 'buf.bin' });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.ok( !!data, "data is defined" );
		test.ok( Buffer.isBuffer(data), "data is a Buffer" );
		test.ok( !!data.length, "data.length is defined" );
		test.ok( data.length == orig.length, "data.length is correct" );
		test.done();
	},
	
	async function testPutStream(test) {
		let inp = fs.createReadStream( 'spacer.gif' );
		let { meta } = await s3.putStream({ key: 'stream.bin', value: inp });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.done();
	},
	
	async function testGetStream(test) {
		let orig = fs.readFileSync( 'spacer.gif' );
		let { data, meta } = await s3.getStream({ key: 'stream.bin' });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.ok( !!data, "data is defined" );
		test.ok( isStream(data), "data is a Stream" );
		
		var bufs = [];
		data.on('data', function(chunk) {
			bufs.push( chunk );
		});
		data.on('end', function() {
			var final = Buffer.concat(bufs);
			test.ok( final.length == orig.length, "Final length is correct" );
			test.done();
		} );
	},
	
	async function testUploadFile(test) {
		let { meta } = await s3.uploadFile({ key: 'spacer.gif', localFile: 'spacer.gif' });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.done();
	},
	
	async function testDownloadFile(test) {
		// cleanup if needed
		if (fs.existsSync('temp.gif')) fs.unlinkSync('temp.gif');
		
		let orig = fs.readFileSync( 'spacer.gif' );
		let { meta } = await s3.downloadFile({ key: 'spacer.gif', localFile: 'temp.gif' });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		
		let final = fs.readFileSync( 'temp.gif' );
		test.ok( final.length == orig.length, "Final length is correct" );
		
		fs.unlinkSync('temp.gif');
		test.done();
	},
	
	async function testUploadFileCompress(test) {
		let { meta } = await s3.uploadFile({ key: 'spacer.gif.gz', localFile: 'spacer.gif', compress: true });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.done();
	},
	
	async function testDownloadFileDecompress(test) {
		// cleanup if needed
		if (fs.existsSync('temp.gif')) fs.unlinkSync('temp.gif');
		
		let orig = fs.readFileSync( 'spacer.gif' );
		let { meta } = await s3.downloadFile({ key: 'spacer.gif.gz', localFile: 'temp.gif', decompress: true });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		
		let final = fs.readFileSync( 'temp.gif' );
		test.ok( final.length == orig.length, "Final length is correct" );
		
		fs.unlinkSync('temp.gif');
		test.done();
	},
	
	async function testUploadMultipleFiles(test) {
		let { files } = await s3.uploadFiles({ remotePath: 'multi', filespec: /\.gif$/, threads: 1, localPath: '.' });
		test.ok( !!files, "files expected in result" );
		test.ok( files.length === 2, "Expected 2 files, got: " + files.length );
		test.done();
	},
	
	async function testDownloadMultipleFiles(test) {
		let { files, bytes } = await s3.downloadFiles({ remotePath: 'multi', filespec: /\.gif$/, threads: 1, localPath: 'multi' });
		test.ok( !!files, "files expected in result" );
		test.ok( files.length === 2, "Expected 2 files, got: " + files.length );
		test.ok( bytes === 2767 + 43, "Unexpected total byte count: " + bytes );
		
		test.ok( fs.existsSync('multi/spacer.gif'), "Expected local file: multi/spacer.gif" );
		test.ok( fs.existsSync('multi/loading.gif'), "Expected local file: multi/loading.gif" );
		Tools.rimraf.sync('multi'); // cleanup
		test.done();
	},
	
	async function testListFolders(test) {
		let { folders, files } = await s3.listFolders({});
		
		test.ok( !!folders, "folders is defined" );
		test.ok( folders.length == 1, "Expected 1 folder, got: " + folders.length );
		test.ok( !!folders[0].match(/\b(multi)\b/), "Unexpected folder returned: " + folders[0] );
		
		test.ok( !!files, "files is defined" );
		test.ok( files.length == 5, "Expected 5 files, got: " + files.length );
		
		files.forEach( function(file) {
			test.ok( !!file.key, "Expected file.key to be truthy" );
			test.ok( !!file.size, "Expected file.size to be truthy" );
			test.ok( !!file.mtime, "Expected file.mtime to be truthy" );
		} );
		
		test.done();
	},
	
	async function testDeleteMultipleFiles(test) {
		let { files, bytes } = await s3.deleteFiles({ remotePath: 'multi', filespec: /\.gif$/, threads: 1 });
		test.ok( !!files, "files expected in result" );
		test.ok( files.length === 2, "Expected 2 files, got: " + files.length );
		test.ok( bytes === 2767 + 43, "Unexpected total byte count: " + bytes );
		test.done();
	},
	
	async function testHeadObject(test) {
		let { meta } = await s3.head({ key: 'spacer.gif' });
		
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.ok( meta.size > 0, "meta.size expected to be non-zero" );
		test.ok( meta.mtime > 0, "meta.mtime expected to be non-zero" );
		test.done();
	},
	
	async function testListObjects(test) {
		let { files, bytes } = await s3.list({});
		
		test.ok( !!files, "files is defined" );
		test.ok( files.length == 5, "Expected 5 files, got: " + files.length );
		test.ok( bytes > 0, "Expected bytes to be non-zero" );
		
		files.forEach( function(file) {
			test.ok( !!file.key, "Expected file.key to be truthy" );
			test.ok( !!file.size, "Expected file.size to be truthy" );
			test.ok( !!file.mtime, "Expected file.mtime to be truthy" );
		} );
		
		test.done();
	},
	
	async function testListWithFilespec(test) {
		let { files, bytes } = await s3.list({ filespec: /\.bin$/ });
		
		test.ok( !!files, "files is defined" );
		test.ok( files.length == 2, "Expected 2 files, got: " + files.length );
		test.ok( bytes > 0, "Expected bytes to be non-zero" );
		
		files.forEach( function(file) {
			test.ok( !!file.key, "Expected file.key to be truthy" );
			test.ok( !!file.size, "Expected file.size to be truthy" );
			test.ok( !!file.mtime, "Expected file.mtime to be truthy" );
		} );
		
		test.done();
	},
	
	async function testNotFoundError(test) {
		var err = null;
		try { 
			await s3.head({ key: 'noexist.blah' });
		}
		catch(e) {
			err = e;
		}
		
		test.ok( !!err, "Expected error for get non-existent key" );
		test.ok( err.code == "NoSuchKey", "Expected error code to be NoSuchKey, got: " + err.code );
		test.done();
	},
	
	async function testDeleteNotFoundError(test) {
		var err = null;
		try { 
			await s3.delete({ key: 'noexist.blah' });
		}
		catch(e) {
			err = e;
		}
		
		test.ok( !!err, "Expected error for delete non-existent key" );
		test.ok( err.code == "NoSuchKey", "Expected error code to be NoSuchKey, got: " + err.code );
		test.done();
	},
	
	async function testCoreS3Error(test) {
		var err = null;
		try { 
			let { meta } = await s3.uploadFile({ bucket: 'adm-no-bucket-unit-failo', key: 'spacer.gif', localFile: 'spacer.gif' });
		}
		catch(e) {
			err = e;
		}
		
		test.ok( !!err, "Expected error for upload to non-existent bucket" );
		test.done();
	},
	
	async function testDeleteCompressedFile(test) {
		let { meta } = await s3.delete({ key: 'spacer.gif.gz' });
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.done();
	},
	
	async function testDeleteFile(test) {
		let { meta } = await s3.delete({ key: 'spacer.gif' });
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.done();
	},
	
	async function testDeleteStream(test) {
		let { meta } = await s3.delete({ key: 'stream.bin' });
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.done();
	},
	
	async function testDeleteBuffer(test) {
		let { meta } = await s3.delete({ key: 'buf.bin' });
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.done();
	},
	
	async function testDeleteJSON(test) {
		let { meta } = await s3.delete({ key: 'test1.json' });
		test.ok( !!meta, "meta is defined" );
		test.ok( !!meta.$metadata, "meta.$metadata is defined" );
		test.ok( meta.$metadata.httpStatusCode >= 200 && meta.$metadata.httpStatusCode <= 299, "meta.$metadata.httpStatusCode expected to be 2xx, got: " + meta.$metadata.httpStatusCode );
		test.done();
	}
	
];

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
