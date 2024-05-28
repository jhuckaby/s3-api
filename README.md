## Overview

The **s3-api** module provides a simple, light wrapper around the AWS S3 API (version 3).  It greatly simplifies things like uploading and downloading files to/from S3, as well as treating it like a key/value store.

## Features

- Uses AWS SDK v3.
- Fully async/await, with support for classic callbacks.
- Use S3 as a key/value store.
- Use JSON, buffers, streams or files.
- Upload or download multiple files or entire directories recursively.
- Optional gzip compression and decompression for files and streams.
- Automatically handles uploading files using multipart chunks.
- Automatically handles pagination when listing files.
- Automatic retries with exponential backoff.
- Logging and perf helpers.
- Optional caching layer for JSON files.
- Progress callback for most API calls.
- Full-featured command-line interface (CLI).

## Table of Contents

The documentation is split up across these files:

- &rarr; **[Main Docs](https://github.com/jhuckaby/s3-api/blob/main/README.md)** *(You are here)*
- &rarr; **[API Reference](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md)**
- &rarr; **[CLI Reference](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md)**

Here is the table of contents for this document:

<!-- toc -->
- [Setup](#setup)
- [API Usage](#api-usage)
	* [Key Value Store](#key-value-store)
		+ [Caching](#caching)
	* [Using Files](#using-files)
		+ [Multiple Files](#multiple-files)
		+ [Compression](#compression)
		+ [Threads](#threads)
	* [Pinging Objects](#pinging-objects)
	* [Listing Objects](#listing-objects)
	* [Deleting Objects](#deleting-objects)
	* [Using Buffers](#using-buffers)
	* [Using Streams](#using-streams)
	* [Custom S3 Params](#custom-s3-params)
	* [Logging](#logging)
		+ [Console](#console)
	* [Performance Tracking](#performance-tracking)
	* [Unit Tests](#unit-tests)
- [CLI Usage](#cli-usage)
	* [Installation](#installation)
	* [File Management](#file-management)
	* [Raw Streams](#raw-streams)
	* [Listing](#listing)
	* [Key Value JSON](#key-value-json)
	* [Backups](#backups)
	* [Snapshots](#snapshots)
	* [Config File](#config-file)
	* [CLI Logging](#cli-logging)
	* [CLI Reference](#cli-reference)
- [License](#license)

## Setup

Use [npm](https://www.npmjs.com/) to install the module locally:

```sh
npm install s3-api
```

Install the module globally to use the CLI:

```sh
npm install -g s3-api
```

## API Usage

To use the API in your code, require the module, and instantiate a class:

```js
const S3 = require('s3-api');

let s3 = new S3({
	credentials: {
		accessKeyId: "YOUR_ACCESS_KEY_HERE",
		secretAccessKey: "YOUR_SECRET_KEY_HERE"
	},
	bucket: 'my-bucket',
	prefix: 'myapp/data/'
});
```

The [class constructor](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#constructor) expects an object, which accepts several different properties (see below).  At the very least you should specify a `bucket` and a `prefix`.  You may also need to specify `credentials` as well, depending on your setup.  The prefix is prepended onto all S3 keys, and is a great way to keep your app's S3 data in an isolated area when sharing a bucket.

Once you have your class instance created, call one of the available API methods (see [API Reference](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md) for list).  Example:

```js
try {
	let result = await s3.uploadFile({ localFile: '/path/to/image.gif', key: 's3dir/myfile.gif' });
	// `result.meta` will be the metadata object from S3
}
catch(err) {
	// handle error here
}
```

The `result` object's properties will vary based on the API call.  In the examples below, the result is destructed into local variables using the `let {...} =` syntax.  This is known as [destructuring assignment](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment).  Example:

```js
try {
	let { files, bytes } = await s3.list({ remotePath: 'mydir' });
	// `files` will be an array of file objects, each with `key`, `size` and `mtime` props.
	// `bytes` is the total bytes of all listed files.
}
catch(err) {
	// handle error here
}
```

Please note that the local variables **must** be named exactly as shown above (e.g. `files`, `bytes` in this case), as they are being yanked from an object.  You can omit specific variables if you don't care about them, e.g. `let { files } = await ...` (omitting `bytes`).  If you don't want to declare new local variables for the object properties, just use the `let result = await ...` syntax instead.

It is highly recommended that you instantiate the S3 API class one time, and reuse it for the lifetime of your application.  The reason is, the library reuses network connections to reduce S3 lag.  Each time you instantiate a new class it has to open new connections.

### Key Value Store

If you want to use S3 as a key/value store, then this is the library for you.  The [put()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#put) and [get()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#get) API calls store and fetch objects, serialized to/from JSON behind the scenes.  Example:

```js
try {
	// store a record
	await s3.put({ key: 'users/kermit', value: { animal: 'frog', color: 'green' } });
	
	// fetch a record
	let { data } = await s3.get({ key: 'users/kermit' });
	console.log(data); // { "animal": "frog", "color": "green" }
}
catch(err) {
	// handle error here
}
```

See [put()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#put) and [get()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#get) for more details.

#### Caching

You can enable optional caching for JSON records, to store then in RAM for a given TTL, or up to a specific item count.   Enable this feature by passing a `cache` object to the class constructor with additional settings.  Example:

```js
const S3 = require('s3-api');

let s3 = new S3({
	bucket: 'my-bucket',
	prefix: 'myapp/data/',
	cache: {
		maxAge: 3600
	}
});
```

This would cache all JSON files fetched using [get()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#get), and stored using [put()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#put), in memory for up to an hour (3600 seconds).  You can also specify other limits including total cache keys, and limit to specific S3 keys by regular expression:

```js
let s3 = new S3({
	bucket: 'my-bucket',
	prefix: 'myapp/data/',
	cache: {
		maxAge: 3600,
		maxItems: 1000,
		keyMatch: /^MYAPP\/MYDIR/
	}
});
```

This would limit the cache objects to 1 hour, and 1,000 total items (oldest keys will be expunged), and also only cache S3 keys that match the regular expression `/^MYAPP\/MYDIR/`.

Note that storing records via [put()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#put) will **always** go to S3.  This is a read cache, not a write cache.  However, objects stored to S3 via [put()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#put) may *also* be stored in the cache, if the key matches your `ketMatch` config property.

Remember that caching **only** happens for JSON records fetched using [get()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#get), and stored using [put()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#put).  It does **not** happen for files, buffers or streams.

### Using Files

The S3 API library provides wrappers for easily managing files in S3.  Here is an example of uploading and downloading a file:

```js
try {
	// upload file
	await s3.uploadFile({ localFile: '/path/to/image.gif', key: 's3dir/myfile.gif' });
	
	// download file
	await s3.downloadFile({ key: 's3dir/myfile.gif', localFile: '/path/to/image.gif' });
}
catch(err) {
	// handle error here
}
```

Streams are always used behind the scenes, so this can handle extremely large files without using significant memory.  When downloading, the parent directories for the destination file will automatically be created if needed.

See [uploadFile()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#uploadfile) and [downloadFile()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#downloadfile) for more details.

#### Multiple Files

You can upload or download multiple files in one call, including entire directories, and traversal of nested directories.  Here is how to do this:

```js
try {
	// upload directory
	await s3.uploadFiles({ localPath: '/path/to/images/', remotePath: 's3dir/uploadedimages/' });
	
	// download directory
	await s3.downloadFiles({ remotePath: 's3dir/uploadedimages/', localPath: '/path/to/images/' });
}
catch(err) {
	// handle error here
}
```

This would upload the entire contents of the local `/path/to/images/` directory, and place the contents into the S3 key `s3dir/uploadedimages/` (i.e. using it as a prefix).  Nested directories are automatically traversed as well.  To control which files are uploaded or downloaded, use the `filespec` property:

```js
try {
	// upload selected files
	await s3.uploadFiles({ localPath: '/path/to/images/', remotePath: 's3dir/uploadedimages/', filespec: /\.gif$/ });
	
	// download selected files
	await s3.downloadFiles({ remotePath: 's3dir/uploadedimages/', localPath: '/path/to/images/', filespec: /\.gif$/ });
}
catch(err) {
	// handle error here
}
```

This would only upload and download files with names ending in `.gif`.  Note that the `filespec` only matches filenames, not directory paths.  See [uploadFiles()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#uploadfiles) and [downloadFiles()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#downloadfiles) for more details.

#### Compression

The S3 API library can handle gzip compression and decompression for you by default.  To do this, add `compress` for compression on upload, and `decompress` for decompression on download.  Example use:

```js
try {
	// upload file w/compression
	await s3.uploadFile({ localFile: '/path/to/report.txt', key: 's3dir/report.txt.gz', compress: true });
	
	// download file w/decompression
	await s3.downloadFile({ key: 's3dir/report.txt.gz', localFile: '/path/to/report.txt', decompress: true });
}
catch(err) {
	// handle error here
}
```

To control the gzip compression level and other settings, specify a `gzip` property in your class constructor:

```js
let s3 = new S3({
	bucket: 'my-bucket',
	prefix: 'myapp/data/',
	gzip: {
		level: 6,
		memLevel: 8
	}
});
```

See the [Node Zlib Class Options](https://nodejs.org/api/zlib.html#zlib_class_options) docs for more on these settings.

When compressing multiple files for upload, you can specify an S3 key `suffix` (to append `.gz` to all filenames for example):

```js
try {
	// upload directory w/compression and suffix
	await s3.uploadFiles({ localPath: '/path/to/images/', remotePath: 's3dir/uploadedimages/', compress: true, suffix: '.gz' });
}
catch(err) {
	// handle error here
}
```

And similarly, when downloading with decompression you can use `strip` to strip off the `.gz` for the decompressed files:

```js
try {
	// download directory w/decompression and strip
	await s3.downloadFiles({ remotePath: 's3dir/uploadedimages/', localPath: '/path/to/images/', decompress: true, strip: /\.gz$/ });
}
catch(err) {
	// handle error here
}
```

#### Threads

When uploading, downloading or deleting multiple files, you can specify a number of threads to use.  This defaults to `1`, meaning operate on a single file at a time, but S3 can often benefit from multiple threads in many cases, due to connection overhead and service lag.  To increase the thread count, specify a `threads` property:

```js
try {
	// upload directory
	await s3.uploadFiles({ localPath: '/path/to/images/', remotePath: 's3dir/uploadedimages/', threads: 4 });
	
	// download directory
	await s3.downloadFiles({ remotePath: 's3dir/uploadedimages/', localPath: '/path/to/images/', threads: 4 });
}
catch(err) {
	// handle error here
}
```

However, please be careful when using multiple threads with compression.  All gzip operations run on the local CPU, not in S3, so you can easily overwhelm a server this way.  It is recommended that you keep the threads at the default when using compression.

### Pinging Objects

To "ping" an object is to quickly check for its existence and fetch basic information about it, without downloading the full contents.  This is typically called "head" in HTTP parlance (i.e. "HTTP HEAD"), and thus the S3 API call is named [head()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#head).  Example:

```js
try {
	// ping a remote object
	let { meta } = await s3.head({ key: 's3dir/myfile.gif' });
	console.log(meta);
}
catch (err) {
	// handle error here
}
```

The `meta` object returned will have the object's size in bytes (`size`), and it's modification date as an Epoch timestamp (`mtime`).  If the object does not exist, an error will be thrown.

### Listing Objects

To generate a listing of remote objects on S3 under a specific key prefix, use the [list()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#list) method:

```js
try {
	// list remote objects
	let { files, bytes } = await s3.list({ remotePath: 's3dir/' });
	console.log(files);
}
catch (err) {
	// handle error here
}
```

This will list all the objects on S3 with a starting key prefix of `s3dir`, returning the array of files and total bytes used.  The [list()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#list) call traverses nested "directories" on S3, and also automatically manages "paging" through the results, so it returns them all in one single array (S3 only allows 1,000 objects per call, hence the need for pagination).

The `files` array will contain an object for each object found, with `key`, `size` and `mtime` properties.  See [list()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#list) below for more details.

To limit which objects are included in the listing, you can specify a `filespec` property:

```js
try {
	// list remote gif files
	let { files, bytes } = await s3.list({ remotePath: 's3dir/', filespec: /\.gif$/ });
	console.log(files);
}
catch (err) {
	// handle error here
}
```

This would only include S3 keys that end with `.gif`.

For even finer grain control over which files are returned, you can specify a `filter` function, which will be invoked for each file.  It will be passed a single object containing the `key`, `size` and `mtime` properties.  The function can return `true` to include the file or `false` to exclude.  Example use:

```js
try {
	// list files larger than 1 MB
	let { files, bytes } = await s3.list({ 
		remotePath: 's3dir/', 
		filter: function(file) { return file.size > 1048576; } 
	});
	console.log(files);
}
catch (err) {
	// handle error here
}
```

### Deleting Objects

To delete an object from S3, simply call [delete()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#delete) and specify the S3 `key`.  Example:

```js
try {
	// delete a remote object
	await s3.delete({ key: 's3dir/myfile.gif' });
}
catch (err) {
	// handle error here
}
```

To delete *multiple* objects in one call, use the [deleteFiles()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#deletefiles) method.  You can then set `remotePath` to specify a starting path, and optionally `filespec` to limit which files are deleted.  Example:

```js
try {
	// delete remote gif files
	await s3.deleteFiles({ remotePath: 's3dir/', filespec: /\.gif$/ });
}
catch (err) {
	// handle error here
}
```

Please note that [deleteFiles()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#deletefiles) will recursively scan nested "directories" on S3, so use with extreme care.

### Using Buffers

If you would rather deal with buffers instead of files, the S3 API library supports low-level [putBuffer()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#putbuffer) and [getBuffer()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#getbuffer) calls.  This is useful if you already have a file's contents loaded into memory.  Example:

```js
let buf = fs.readFileSync( '/path/to/image.gif' );

try {
	// upload buffer
	await s3.putBuffer({ key: 's3dir/myfile.gif', value: buf });
	
	// download buffer
	let { data } = await s3.getBuffer({ key: 's3dir/myfile.gif' });
}
catch (err) {
	// handle error here
}
```

Remember, buffers are all held in memory, so beware of large objects that could melt your server.  It is recommended that you use streams whenever possible (see next section).

### Using Streams

Using streams is the preferred way of dealing with large objects, as they use very little memory.  The API library provides [putStream()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#putstream) and [getStream()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#getstream) calls for your convenience.  Here is an example of uploading a stream:

```js
let readStream = fs.createReadStream( '/path/to/image.gif' );

try {
	// upload stream to S3
	await s3.putStream({ key: 's3dir/myfile.gif', value: readStream });
}
catch (err) {
	// handle error here
}
```

And here is an example of downloading a stream, and piping it to a file:

```js
let writeStream = fs.createWriteStream( '/path/to/image.gif' );

try {
	// download stream from S3
	let { data } = await s3.getStream({ key: 's3dir/myfile.gif' });
	
	// pipe it to local file
	data.pipe( writeStream );
	
	writeStream.on('finish', function() {
		// download complete
	});
}
catch (err) {
	// handle error here
}
```

Note that [putStream()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#putstream) will completely upload the entire stream to completion before returning, whereas [getStream()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#getstream) simply *starts* a stream, and returns a handle to you for piping or reading.

Both stream methods can automatically compress or decompress with gzip if desired.  Simply include a `compress` property and set it to true for upload compression, or a `decompress` property set to true for download decompression.

### Custom S3 Params

All of the upload related calls (i.e. [put()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#put), [update()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#update), [uploadFile()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#uploadfile), [uploadFiles()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#uploadfiles), [putBuffer()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#putbuffer) and [putStream()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#putstream)) accept an optional `params` object.  This allows you specify options that are passed directly to the AWS S3 API, for things like ACL and Storage Class.  Example:

```js
let opts = {
	localFile: '/path/to/image.gif', 
	key: 's3dir/myfile.gif',
	params: {
		ACL: 'public-read',
		StorageClass: 'STANDARD_IA'
	}
};

try {
	// upload file
	await s3.uploadFile(opts);
}
catch(err) {
	// handle error here
}
```

This would set the ACL to `public-read` (see [AWS - Canned ACL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/acl-overview.html#canned-acl)), and the S3 storage class to "Infrequently Accessed" (a cheaper storage tier with reduced redundancy and performance -- see [AWS - Storage Classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)).  As of this writing, the supported storage class names are:

- STANDARD
- REDUCED_REDUNDANCY
- STANDARD_IA
- ONEZONE_IA
- INTELLIGENT_TIERING
- GLACIER
- DEEP_ARCHIVE
- GLACIER_IR

If you are uploading files to a S3 bucket that is hosting a static website, then you can use `params` to bake in headers like `Content-Type` and `Cache-Control`.  Example:

```js
let opts = {
	localFile: '/path/to/image.gif', 
	key: 's3dir/myfile.gif',
	params: {
		ContentType: 'image/gif',
		CacheControl: 'max-age=86400'
	}
};

try {
	// upload file
	await s3.uploadFile(opts);
}
catch(err) {
	// handle error here
}
```

You can alternatively declare some `params` in the class constructor, so you don't have to specify them for each API call:

```js
let s3 = new S3({
	bucket: 'my-bucket',
	prefix: 'myapp/data/',
	params: {
		ACL: 'public-read',
		StorageClass: 'STANDARD_IA'
	}
});

try {
	// upload file
	await s3.uploadFile({ localFile: '/path/to/image.gif', key: 's3dir/myfile.gif' });
}
catch(err) {
	// handle error here
}
```

When `params` are specified in both places, they are merged together, and the properties in the API call take precedence over those defined in the class instance.

For a complete list of all the properties you can specify in `params`, see the [AWS - PutObjectRequest](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/Interface/PutObjectRequest/) docs.

### Non-AWS S3 Providers

It is possible to connect to a non-AWS S3-compatible provider such as [MinIO](https://min.io/).  To do this, you need to specify some additional properties when constructing the class:

```js
let s3 = new S3({
	endpoint: "http://MINIO_HOST:9000",
	forcePathStyle: true,
	
	credentials: {
		accessKeyId: "YOUR_ACCESS_KEY_HERE",
		secretAccessKey: "YOUR_SECRET_KEY_HERE"
	},
	
	bucket: 'my-bucket',
	prefix: 'myapp/data/'
});
```

See the [class constructor](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#constructor) reference for more details.

To start a local MinIO server using Docker, run this command:

```sh
docker run --name minio -p 9000:9000 -p 9001:9001 quay.io/minio/minio server /data --console-address ":9001"
```

### Logging

You can optionally attach a [pixl-logger](https://github.com/jhuckaby/pixl-logger) compatible logger to the API class, which can log all requests and responses, as well as errors.  Example:

```js
const Logger = require('pixl-logger');
let logger = new Logger( 'debug.log', ['hires_epoch', 'date', 'hostname', 'component', 'category', 'code', 'msg', 'data'] );

s3.attachLogAgent( logger );
```

Debug log entries are logged at levels 8 and 9, with the `component` column set to `S3`.  Errors are logged with the `component` set to `S3` and the `code` column set to one of the following:

| Error Code | Description |
|------------|-------------|
| `err_s3_get` | An S3 core error attempting to fetch an object.  Note that a non-existent object is **not** logged as an error. |
| `err_s3_put` | An S3 core error attempting to put an object. |
| `err_s3_delete` | An S3 core error attempting to delete an object.  Note that a non-existent object is **not** logged as an error. |
| `err_s3_head` | An S3 core error attempting to head (ping) an object.  Note that a non-existent object is **not** logged as an error. |
| `err_s3_json` | A JSON parser error when fetching a JSON record. |
| `err_s3_file` | A local filesystem error attempting to stat a file. |
| `err_s3_dir` | A local filesystem error attempting to create directories. |
| `err_s3_glob` | A local filesystem error attempting to glob (scan) files. |
| `err_s3_stream` | A read or write stream error. |
| `err_s3_gzip` | An error attempting to compress or decompress via gzip (zlib). |

In all cases, a verbose error description will be provided in the `msg` column.

#### Console

To log everything to the console, you can simulate a [pixl-logger](https://github.com/jhuckaby/pixl-logger) compatible logger like this:

```js
s3.attachLogAgent( {
	debug: function(level, msg, data) {
		console.log( code, msg, data );
	},
	error: function(code, msg, data) {
		console.error( code, msg, data );
	}
} );
```

### Performance Tracking

You can optionally attach a [pixl-perf](https://github.com/jhuckaby/pixl-perf) compatible performance tracker to the API class, which will measure all S3 calls for you.  Example:

```js
const Perf = require('pixl-perf');
let perf = new Perf();
perf.begin();

s3.attachPerfAgent( perf );
```

It will track the following performance metrics for you:

| Perf Metric | Description |
|-------------|-------------|
| `s3_put` | Measures all S3 upload operations, including [put()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#put), [uploadFile()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#uploadfile), [uploadFiles()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#uploadfiles), [putBuffer()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#putbuffer) and [putStream()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#putstream)). |
| `s3_get` | Measures all S3 download operations, including [get()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#get), [downloadFile()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#downloadfile), [downloadFiles()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#downloadfiles), [getBuffer()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#getbuffer) and [getStream()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#getstream)). |
| `s3_head` | Measures all calls to [head()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#head). |
| `s3_list` | Measures all calls to [list()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#list). |
| `s3_copy` | Measures all calls to [copyFile()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#copyfile). |
| `s3_delete` | Measures all calls to [deleteFile()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#deletefile) and [deleteFiles()](https://github.com/jhuckaby/s3-api/blob/main/docs/API.md#deletefiles). |

### Unit Tests

To run the unit tests, you must set some environment variables instructing the code which S3 bucket and region to use.  Example:

```sh
S3API_TEST_REGION=us-west-1 S3API_TEST_BUCKET=my-bucket npm test
```

All test records will be created under a `test/s3apiunit/PID/` key prefix, and everything will be deleted when the tests complete.  If any tests fail, however, there may be a few records leftover (deliberately, for debugging purposes), so you may need to delete those manually.

If you do not have automatic AWS authentication setup on your machine (e.g. `~/.aws/credentials` file or other), you may need to set the following two environment variables as well:

```
S3API_TEST_ACCESSKEYID
S3API_TEST_SECRETACCESSKEY
```

## CLI Usage

**s3-api** comes with a CLI tool which you can use to send S3 API calls from your terminal.  When you install the module globally (see below), it installs a single command called `s3` which is the CLI entry point.  The general syntax of the CLI is:

```
s3 COMMAND [ARG1 ARG2...] [--KEY VALUE --KEY VALUE...]
```

Example command:

```sh
s3 upload /path/to/image.gif s3://my-bucket/s3dir/myfile.gif
```

Each command typically takes one or more plain arguments, and most also support a number of "switches" (key/value arguments specified using a double-dash, e.g. `--key value`).

Please note that the standard [AWS S3 CLI](https://docs.aws.amazon.com/cli/latest/reference/s3/) is a much more feature-rich (not to mentioned battle-hardened) tool, and you should consider using that instead.  This module is a simplified wrapper that only supports basic S3 commands.

### Installation

Use [npm](https://www.npmjs.com/) to install the module globally like this:

```sh
npm install -g s3-api
```

This will install a global `s3` command in your PATH (typically in `/usr/bin`).

### File Management

The CLI allows you to easily upload and download files to/from S3 using the [upload](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#upload) and [download](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#download) commands.  Here are examples:

```sh
# Upload single file
s3 upload /path/to/image.gif s3://my-bucket/s3dir/myfile.gif

# Download single file
s3 download s3://my-bucket/s3dir/myfile.gif /path/to/image.gif
```

You can also upload and download multiple files and entire directories using [uploadFiles](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#uploadfiles) and [downloadFiles](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#downloadfiles):

```sh
# Upload entire folder
s3 uploadFiles /path/to/images/ s3://my-bucket/s3dir/uploaded/

# Download entire folder
s3 downloadFiles s3://my-bucket/s3dir/uploaded/ /path/to/images/
```

These commands provide several ways of filtering files and paths to exclude files, or only include certain files.  Example:

```sh
# Only upload GIF images
s3 uploadFiles /path/to/images/ s3://my-bucket/s3dir/uploaded/ --filespec '\.gif$'

# Only download files over than 1 week
s3 downloadFiles s3://my-bucket/s3dir/uploaded/ /path/to/images/ --older "1 week"

# Only upload files larger than 2MB
s3 uploadFiles /path/to/images/ s3://my-bucket/s3dir/uploaded/ --larger "2 MB"
```

These commands all support optional upload compression, and/or download decompression, so you can store `.gz` compressed files in S3, and decompress them on download.  Examples:

```sh
# Upload a bunch of files and compress with gzip (and add ".gz" suffix to all S3 files)
s3 uploadFiles /path/to/files/ s3://my-bucket/s3dir/uploaded/ --compress --suffix ".gz"

# Download a bunch of gzip files and decompress (and strip off ".gz" suffix)
s3 downloadFiles s3://my-bucket/s3dir/uploaded/ /path/to/files/ --decompress --strip '\.gz$'
```

You can also copy & move files around (even across buckets) using [copy](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#copy) and [move](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#move):

```sh
# Copy file
s3 copy s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json

# Move file
s3 move s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json
```

And to copy or move multiple files, use [copyFiles](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#copyfiles) or [moveFiles](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#movefiles) respectively:

```sh
# Copy entire folder
s3 copyFiles s3://my-bucket/users/ s3://my-bucket/newusers/

# Move entire folder
s3 moveFiles s3://my-bucket/users/ s3://my-bucket/newusers/
```

You can delete single S3 files and entire folder trees using the [delete](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#delete) and [deleteFiles](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#deletefiles) commands:

```sh
# Delete file
s3 delete s3://my-bucket/users/newkermit.json

# Delete entire folder
s3 deleteFiles s3://my-bucket/s3dir/uploaded/
```

The `deleteFiles` command also accepts all the filtering options that `uploadFiles` and `downloadFiles` use.  Example:

```sh
# Delete selected files
s3 deleteFiles s3://my-bucket/s3dir/uploaded/ --filespec '\.gif$' --older "15 days"
```

To check if a file exists and view its metadata, use the [head](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#head) command:

```sh
s3 head s3://my-bucket/s3dir/myfile.gif
```

### Raw Streams

You can upload and download raw streams from STDIN, or to STDOUT, using the [putStream](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#putstream) and [getStream](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#getstream) commands.  Examples:

```sh
# Upload stream from file
cat /path/to/myfile.gif | s3 putStream s3://my-bucket/s3dir/myfile.gif

# Download stream to file
s3 getStream s3://my-bucket/s3dir/myfile.gif --quiet > /path/to/myfile.gif
```

### Listing

To list remote files in S3, including files in nested folders, use the [list](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#list) command:

```sh
s3 list s3://my-bucket/s3dir/
```

To list only a single level of files and folders, use the [listFolders](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#listfolders) command:

```sh
s3 listFolders s3://my-bucket/s3dir/
```

To list all your S3 buckets, use the [listBuckets](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#listbuckets) command:

```sh
s3 listBuckets
```

### Key Value JSON

If you want to use S3 as a key/value store, then this is the CLI for you.  The [put](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#put) and [get](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#get) commands store and fetch objects, serialized to/from JSON behind the scenes.  Examples:

```sh
# Put JSON record using raw JSON
s3 put s3://my-bucket/users/kermit.json '{"animal":"frog", "color":"green"}'

# Build JSON record using dot.path.notation
s3 put s3://my-bucket/users/kermit.json --value.animal "frog" --value.color "green"

# Get JSON record
s3 get s3://my-bucket/users/kermit.json --pretty
```

You can also use the [update](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#update) command to make edits to JSON records using dot.path.notation.  Example:

```sh
s3 update s3://my-bucket/users/kermit.json --update.animal "toad" --update.color "yellow"
```

Using dot.path.notation you can add, replace and delete keys, access nested keys inside of objects, and even create new objects.  See the [reference guide](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#update) for details.

### Backups

The [backup](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#backup) command makes a point-in-time backup of a local directory, compresses it using `.zip`, `.tar`, `.tar.gz`, `.tar.xz` or `.tar.bz2`, and uploads the archive to S3.  Example:

```sh
s3 backup /path/to/files/ s3://my-bucket/backups/mybackup-[yyyy]-[mm]-[dd].zip
```

You can use date/time placeholders in the destination S3 key, to embed a custom timestamp.

If you make backups on a schedule, and only want to keep a certain amount in S3, add an `--expire` argument with a relative time (e.g. `30 days`) and the `backup` command will automatically delete archives that fall outside the specified date range.

You can also restore backups using the [restoreBackup](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#restoreBackup) command.  This reverses the process, downloads a backup archive from S3, and decompresses it back onto the filesystem.  Example:

```sh
s3 restoreBackup s3://my-bucket/backups/mybackup-2024-05-22.zip /path/to/files/
```

You can also optionally "pre-delete" the local directory to ensure an exact restoration.  To do this, add a `--delete` argument to the command.  Example:

```sh
s3 restoreBackup s3://my-bucket/backups/mybackup-2024-05-22.zip /path/to/files/ --delete
```

### Snapshots

A "snapshot" works in the opposite direction of a backup.  A snapshot is a effectively a point-in-time backup of an S3 location, including all nested files and directories.  The [snapshot](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#snapshot) command downloads all S3 files and writes a local `.zip`, `.tar`, `.tar.gz`, `.tar.xz` or `.tar.bz2` archive file.  Example:

```sh
s3 snapshot s3://my-bucket/s3dir/images/ /path/to/snapshot-[yyyy]-[mm]-[dd].zip
```

This would download and compress the entire `s3://my-bucket/s3dir/images/` location and everything under it, and write it to `/path/to/snapshot-[yyyy]-[mm]-[dd].zip` on local disk.  You can use date/time placeholders in the destination filename, to embed a custom timestamp.

If you take snapshots on a schedule, and only want to keep a certain amount on disk, add an `--expire` argument with a relative time (e.g. `30 days`) and the `snapshot` command will automatically delete snapshots that fall outside the specified date range.

To restore a snapshot back to S3, use the [restoreSnapshot](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#restoresnapshot) command.  This decompresses a snapshot archive and re-uploads all files back to their original location (or a custom location).  Example:

```sh
s3 restoreSnapshot /path/to/snapshot-2024-05-22.zip s3://my-bucket/s3dir/images/
```

You can also optionally "pre-delete" the target S3 location to ensure an exact restoration.  To do this, add a `--delete` argument to the command.  Example:

```sh
s3 restoreSnapshot /path/to/snapshot-2024-05-22.zip s3://my-bucket/s3dir/images/ --delete
```

### Config File

The CLI supports an optional configuration file, which should live in your home directory and named `.s3-config.json` (with a leading period).  Example file path for root:

```
/root/.s3-config.json
```

The file should be in JSON format, and can store one or more [Common Arguments](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md#common-arguments) that act as defaults for the CLI.  This is a great way to specify your AWS region, logging options, and other things as well, so you don't have to pass them on the command-line every time.  Example config file:

```json
{
	"region": "us-west-1",
	"log": "/var/log/s3-cli.log"
}
```

You can also use dot.path.notation here to configure things such as AWS credentials, a default S3 storage class, and/or default ACL for all S3 objects.  Example:

```json
{
	"region": "us-west-1",
	"log": "/var/log/s3-cli.log",
	
	"credentials.accessKeyId": "YOUR_ACCESS_KEY_HERE",
	"credentials.secretAccessKey": "YOUR_SECRET_KEY_HERE",
	
	"params.StorageClass": "STANDARD_IA",
	"params.ACL": "public-read"
}
```

Note that arguments in the config file should **not** have a double-dash prefix like they do on the command-line.

### CLI Logging

The CLI supports an optiona log file, which contains all output, as well as verbose debug information.  To enable the log, add `--log FILE` to any command, or place it in your [config file](#config-file).  Each line is annotated with a timestamp.  Example log snippet:

```
[2024/05/26 14:03:16] 🪣 S3 API v2.0.0
[2024/05/26 14:03:16] {"region":"us-west-1","bucket":"my-bucket","key":"users-test.json","updates":{"num":1}}
[2024/05/26 14:03:16] Updating JSON record: users-test.json
[2024/05/26 14:03:16] {"bucket":"my-bucket","key":"users-test.json","updates":{"num":1}}
[2024/05/26 14:03:16] Fetching JSON record: users-test.json
[2024/05/26 14:03:16] {"bucket":"my-bucket","key":"users-test.json"}
[2024/05/26 14:03:16] Fetching stream: users-test.json
[2024/05/26 14:03:16] {"Metadata":{"animal":"frog","num":1},"Bucket":"my-bucket","Key":"users-test.json"}
[2024/05/26 14:03:16] Stream started: users-test.json
[2024/05/26 14:03:16] Converting stream to buffer: users-test.json
[2024/05/26 14:03:16] Fetch complete: users-test.json
[2024/05/26 14:03:16] 21 bytes
[2024/05/26 14:03:16] JSON fetch complete: users-test.json
[2024/05/26 14:03:16] Storing JSON record: users-test.json
[2024/05/26 14:03:16] {"bucket":"my-bucket","key":"users-test.json"}
[2024/05/26 14:03:16] Storing Buffer: users-test.json (21 bytes)
[2024/05/26 14:03:16] {"ContentType":"application/json"}
[2024/05/26 14:03:16] Storing Stream: users-test.json
[2024/05/26 14:03:16] {"Metadata":{"animal":"frog","num":"1"},"ContentType":"application/json","Bucket":"my-bucket","Key":"users-test.json"}
[2024/05/26 14:03:16] Store complete: users-test.json
```

A few other notes about the CLI log:

- Verbose debugging information is always logged, even if `--verbose` mode is disabled.
- The log will contain all CLI output even if it is silenced with `--quiet` mode.
- All color is stripped from the log.

### CLI Reference

See the [CLI Reference](https://github.com/jhuckaby/s3-api/blob/main/docs/CLI.md) for more details.

## License

**The MIT License (MIT)**

*Copyright (c) 2023 - 2024 Joseph Huckaby and PixlCore.*

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
