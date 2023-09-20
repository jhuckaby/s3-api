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

## Setup

Use [npm](https://www.npmjs.com/) to install the module locally:

```
npm install s3-api
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
	bucket: 'my-bucket-uswest1',
	prefix: 'myapp/data/'
});
```

The class constructor expects an object, which accepts several different properties (see below).  At the very least you should specify a `bucket` and a `prefix`.  You may also need to specify `credentials` as well, depending on your setup.  The prefix is prepended onto all S3 keys, and is a great way to keep your app's S3 data in an isolated area when sharing a bucket.

Once you have your class instance created, call one of the available API methods (see [API Reference](#api-reference) for list).  Example:

```js
try {
	let args = await s3.uploadFile({ localFile: '/path/to/image.gif', key: 's3dir/myfile.gif' });
	// `args.meta` will be the metadata object from S3
}
catch(err) {
	// handle error here
}
```

The result `args` object properties will vary based on the API call.  In the examples below, `args` is destructed into local variables using the `let {...} =` syntax.  This is known as [destructuring assignment](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment).  Example:

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

Please note that the local variables **must** be named exactly as shown above (e.g. `files`, `bytes` in this case), as they are being yanked from an object.  You can omit specific variables if you don't care about them, e.g. `let { files } = ` (omitting `bytes`).  If you don't want to declare new local variables for the object properties, just use the `let args =` syntax instead.

It is highly recommended that you instantiate the S3 API class one time, and reuse it for the lifetime of your application.  The reason is, the library reuses network connections to reduce S3 lag.  Each time you instantiate a new class it has to open new connections.

### Key / Value Store

If you want to use S3 as a key/value store, then this is the library for you.  The [put()](#put) and [get()](#get) API calls store and fetch objects, serialized to/from JSON behind the scenes.  Example:

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

See [put()](#put) and [get()](#get) for more details.

#### Caching

You can enable optional caching for JSON records, to store then in RAM for a given TTL, or up to a specific item count.   Enable this feature by passing a `cache` object to the class constructor with additional settings.  Example:

```js
const S3 = require('s3-api');

let s3 = new S3({
	bucket: 'my-bucket-uswest1',
	prefix: 'myapp/data/',
	cache: {
		maxAge: 3600
	}
});
```

This would cache all JSON files fetched using [get()](#get), and stored using [put()](#put), in memory for up to an hour (3600 seconds).  You can also specify other limits including total cache keys, and limit to specific S3 keys by regular expression:

```js
let s3 = new S3({
	bucket: 'my-bucket-uswest1',
	prefix: 'myapp/data/',
	cache: {
		maxAge: 3600,
		maxItems: 1000,
		keyMatch: /^MYAPP\/MYDIR/
	}
});
```

This would limit the cache objects to 1 hour, and 1,000 total items (oldest keys will be expunged), and also only cache S3 keys that match the regular expression `/^MYAPP\/MYDIR/`.

Note that storing records via [put()](#put) will **always** go to S3.  This is a read cache, not a write cache.  However, objects stored to S3 via [put()](#put) may *also* be stored in the cache, if the key matches your `ketMatch` config property.

Remember that caching **only** happens for JSON records fetched using [get()](#get), and stored using [put()](#put).  It does **not** happen for files, buffers or streams.

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

See [uploadFile()](#uploadfile) and [downloadFile()](#downloadfile) for more details.

#### Multiple Files

You can upload or download multiple files in one call, including entire directories, and traversal of nested directories.  Here is how to do this:

```js
try {
	// upload directory
	await s3.uploadFiles({ localPath: '/path/to/images', remotePath: 's3dir/uploadedimages' });
	
	// download directory
	await s3.downloadFiles({ remotePath: 's3dir/uploadedimages', localPath: '/path/to/images' });
}
catch(err) {
	// handle error here
}
```

This would upload the entire contents of the local `/path/to/images` directory, and place the contents into the S3 key `s3dir/uploadedimages` (i.e. using it as a prefix).  Nested directories are automatically traversed as well.  To control which files are uploaded or downloaded, use the `filespec` property:

```js
try {
	// upload selected files
	await s3.uploadFiles({ localPath: '/path/to/images', remotePath: 's3dir/uploadedimages', filespec: /\.gif$/ });
	
	// download selected files
	await s3.downloadFiles({ remotePath: 's3dir/uploadedimages', localPath: '/path/to/images', filespec: /\.gif$/ });
}
catch(err) {
	// handle error here
}
```

This would only upload and download files with names ending in `.gif`.  Note that the `filespec` only matches filenames, not directory paths.  See [uploadFiles()](#uploadfiles) and [downloadFiles()](#downloadfiles) for more details.

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
	bucket: 'my-bucket-uswest1',
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
	await s3.uploadFiles({ localPath: '/path/to/images', remotePath: 's3dir/uploadedimages', compress: true, suffix: '.gz' });
}
catch(err) {
	// handle error here
}
```

And similarly, when downloading with decompression you can use `strip` to strip off the `.gz` for the decompressed files:

```js
try {
	// download directory w/decompression and strip
	await s3.downloadFiles({ remotePath: 's3dir/uploadedimages', localPath: '/path/to/images', decompress: true, strip: /\.gz$/ });
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
	await s3.uploadFiles({ localPath: '/path/to/images', remotePath: 's3dir/uploadedimages', threads: 4 });
	
	// download directory
	await s3.downloadFiles({ remotePath: 's3dir/uploadedimages', localPath: '/path/to/images', threads: 4 });
}
catch(err) {
	// handle error here
}
```

However, please be careful when using multiple threads with compression.  All gzip operations run on the local CPU, not in S3, so you can easily overwhelm a server this way.  It is recommended that you keep the threads at the default when using compression.

### Pinging Objects

To "ping" an object is to quickly check for its existence and fetch basic information about it, without downloading the full contents.  This is typically called "head" in HTTP parlance (i.e. "HTTP HEAD"), and thus the S3 API call is named [head()](#head).  Example:

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

To generate a listing of remote objects on S3 under a specific key prefix, use the [list()](#list) method:

```js
try {
	// list remote objects
	let { files, bytes } = await s3.list({ remotePath: 's3dir' });
	console.log(files);
}
catch (err) {
	// handle error here
}
```

This will list all the objects on S3 with a starting key prefix of `s3dir`, returning the array of files and total bytes used.  The [list()](#list) call traverses nested "directories" on S3, and also automatically manages "paging" through the results, so it returns them all in one single array (S3 only allows 1,000 objects per call, hence the need for pagination).

The `files` array will contain an object for each object found, with `key`, `size` and `mtime` properties.  See [list()](#list) below for more details.

To limit which objects are included in the listing, you can specify a `filespec` property:

```js
try {
	// list remote gif files
	let { files, bytes } = await s3.list({ remotePath: 's3dir', filespec: /\.gif$/ });
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
	let { files, bytes } = await s3.list({ remotePath: 's3dir', filter: function(file) { return file.size > 1048576; } });
	console.log(files);
}
catch (err) {
	// handle error here
}
```

### Deleting Objects

To delete an object from S3, simply call [delete()](#delete) and specify the S3 `key`.  Example:

```js
try {
	// delete a remote object
	await s3.delete({ key: 's3dir/myfile.gif' });
}
catch (err) {
	// handle error here
}
```

To delete *multiple* objects in one call, use the [deleteFiles()](#deletefiles) method.  You can then set `remotePath` to specify a starting path, and optionally `filespec` to limit which files are deleted.  Example:

```js
try {
	// delete remote gif files
	await s3.deleteFiles({ remotePath: 's3dir', filespec: /\.gif$/ });
}
catch (err) {
	// handle error here
}
```

Please note that [deleteFiles()](#deletefiles) will recursively scan nested "directories" on S3, so use with extreme care.

### Using Buffers

If you would rather deal with buffers instead of files, the S3 API library supports low-level [putBuffer()](#putbuffer) and [getBuffer()](#getbuffer) calls.  This is useful if you already have a file's contents loaded into memory.  Example:

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

Using streams is the preferred way of dealing with large objects, as they use very little memory.  The API library provides [putStream()](#putstream) and [getStream()](#getstream) calls for your convenience.  Here is an example of uploading a stream:

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

Note that [putStream()](#putstream) will completely upload the entire stream to completion before returning, whereas [getStream()](#getstream) simply *starts* a stream, and returns a handle to you for piping or reading.

Both stream methods can automatically compress or decompress with gzip if desired.  Simply include a `compress` property and set it to true for upload compression, or a `decompress` property set to true for download decompression.

### Custom S3 Params

All of the upload related calls (i.e. [put()](#put), [uploadFile()](#uploadfile), [uploadFiles()](#uploadfiles), [putBuffer()](#putbuffer) and [putStream()](#putstream)) accept an optional `params` object.  This allows you specify options that are passed directly to the AWS S3 API, for things like ACL and Storage Class.  Example:

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

This would set the ACL to `public-read` (see [AWS - Canned ACL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/acl-overview.html#canned-acl)), and the S3 storage class to "Infrequently Accessed" (a cheaper storage tier with reduced redundancy and performance -- see [AWS - Storage Classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)).

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
	bucket: 'my-bucket-uswest1',
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

For a complete list of all the properties you can specify in `params`, see the [AWS - PutObjectRequest](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/interfaces/putobjectrequest.html) docs.

## Logging

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

### Console

To log everything to the console, you can simulate a [pixl-logger](https://github.com/jhuckaby/pixl-logger) compatible logger like this:

```js
s3.attachLogAgent( {
	debug: function(level, msg, data) {
		console.log( code, msg, data ):
	},
	error: function(code, msg, data) {
		console.error( code, msg, data ):
	}
} );
```

## Performance Tracking

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
| `s3_put` | Measures all S3 upload operations, including [put()](#put), [uploadFile()](#uploadfile), [uploadFiles()](#uploadfiles), [putBuffer()](#putbuffer) and [putStream()](#putstream)). |
| `s3_get` | Measures all S3 download operations, including [get()](#get), [downloadFile()](#downloadfile), [downloadFiles()](#downloadfiles), [getBuffer()](#getbuffer) and [getStream()](#getstream)). |
| `s3_head` | Measures all calls to [head()](#head). |
| `s3_list` | Measures all calls to [list()](#list). |
| `s3_copy` | Measures all calls to [copy()](#copy). |
| `s3_delete` | Measures all calls to [delete()](#delete) and [deleteFiles()](#deletefiles). |

## API Reference

### constructor

The class constructor accepts an object containing configuration properties.  The following properties are available:

| Property Name | Type | Description |
|---------------|------|-------------|
| `credentials` | Object | Your AWS credentials (containing `accessKeyId` and `secretAccessKey`) if required. |
| `region` | String | The AWS region to use for the S3 API.  Defaults to `us-west-1`. |
| `bucket` | String | The S3 bucket to use by default.  You can optionally override this per API call. |
| `prefix` | String | An optional prefix to prepend onto all S3 keys.  Useful for keeping all of your app's keys under a common prefix. |
| `params` | Object | An optional object to set S3 object metadata.  See [Custom S3 Params](#custom-s3-params). |
| `gzip` | Object | Optionally configure the gzip compression settings.  See [Compression](#compression). |
| `timeout` | Integer | The number of milliseconds to wait before killing idle sockets.  The default is `5000` (5 seconds). |
| `connectTimeout` | Integer | The number of milliseconds to wait when initially connecting to S3.  The default is `5000` (5 seconds). |
| `retries` | Integer | The number of retries to attempt before failing each request.  The default is `50`.  Exponential backoff is included. |
| `logger` | Object | Optionally pass in a [pixl-logger](https://github.com/jhuckaby/pixl-logger) compatible logger here.  Or use [attachLogAgent()](#attachlogagent). |
| `perf` | Object | Optionally pass in a [pixl-perf](https://github.com/jhuckaby/pixl-perf) compatible perf tracker here.  Or use [attachPerfAgent()](#attachperfagent). |
| `cache` | Object | Optionally enable caching for JSON records.  See [Caching](#caching) for details. |

Example use:

```js
let s3 = new S3({
	bucket: 'my-bucket-uswest1',
	prefix: 'myapp/data/'
});
```

### attachLogAgent

The `attachLogAgent()` method allows you to attach a [pixl-logger](https://github.com/jhuckaby/pixl-logger) compatible logger to your API class.  It will log all requests and responses.  Example use:

```js
s3.attachLogAgent( logger );
```

See [Logging](#logging) for details on what is logged.

### attachPerfAgent

The `attachPerfAgent()` method allows you to attach a [pixl-perf](https://github.com/jhuckaby/pixl-perf) compatible performance tracker to your API class.  It will measure all calls to S3.  Example use:

```js
s3.attachPerfAgent( perf );
```

See [Performance Tracking](#performance-tracking) for details on what is tracked.

### put

The `put()` method stores an object as a JSON-serialized record in S3, treating it like a key/value store.  Example:

```js
try {
	// store a record
	let { meta } = await s3.put({ key: 'users/kermit', value: { animal: 'frog', color: 'green' } });
}
catch(err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | **(Required)** The S3 key to store the object under.  This may be prepended with a `prefix` if set on the class instance. |
| `value` | Object | **(Required)** The object value to store.  This will be serialized to JSON behind the scenes. |
| `pretty` | Boolean | Optionally serialize the JSON using "pretty-printing" (formatting with multiple lines and tab indentations) by setting this to `true`.  The default is `false`. |
| `bucket` | String | Optionally override the S3 bucket used to store the record.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

### get

The `get()` method fetches an object that was written in JSON format (e.g. from [put()](#put), or it can just be a JSON file that was uploaded to S3), and parses the JSON for you.  Example:

```js
try {
	// fetch a record
	let { data } = await s3.get({ key: 'users/kermit' });
	console.log(data); // { "animal": "frog", "color": "green" }
}
catch(err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | **(Required)** The S3 key of the object you want to get.  This may be prepended with a `prefix` if set on the class instance. |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `data` | Object | The content of the JSON record, parsed and in object format. |
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

**Note:** When [Caching](#caching) is enabled and an object is fetched from the cache, the `meta` response object will simply contain a single `cached` property, set to `true`.

### head

The `head()` method pings an object to check for its existence, and returns basic information about it.  Example:

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

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | **(Required)** The S3 key of the object you want to ping.  This may be prepended with a `prefix` if set on the class instance. |
| `nonfatal` | Boolean | Set this to `true` to suppress errors for non-existent keys (`meta` will simply be `null` in these cases).  The default is `false`. |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

In this case the `meta` object is augmented with the record's size (`size`) and modification date (`mtime`):

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta.size` | Integer | The object's size in bytes. |
| `meta.mtime` | Integer | The object's modification date in Epoch seconds. |

**Note:** The `head()` method bypasses the [Cache](#caching).  It always hits S3.

### list

The `list()` method fetches a listing of remote S3 objects that exist under a specified key prefix, and optionally match a specified filter.  It will automatically loop and paginate as required, returning the full set of matched objects regardless of length.  Example:

```js
try {
	// list remote gif files
	let { files, bytes } = await s3.list({ remotePath: 's3dir', filespec: /\.gif$/ });
	console.log(files);
}
catch (err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `remotePath` | String | The base S3 path to look for files under.  This may be prepended with a `prefix` if set on the class instance. |
| `filespec` | RegExp | Optionally filter the result files using a regular expression, matched on the filenames. |
| `filter` | Function | Optionally provide a filter function to select which files to return. |
| `older` | Number | Optionally filter the S3 files based on their modification date, i.e. they must be older than the specified number of seconds.  You can also specify a string here, e.g. "7 days". |
| `bucket` | String | Optionally specify the S3 bucket where the records are stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `files` | Array | An array of file objects that matched your criteria.  See below for details. |
| `bytes` | Integer | The total number of bytes used by all matched objects. |

The items of the `files` array will contain the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | The object's full S3 key (including prefix if applicable). |
| `size` | Integer | The objects's size in bytes. |
| `mtime` | Integer | The object's modification date, as Epoch seconds. |

### listFolders

The `listFolders()` method fetches a listing of remote S3 files and "subfolders" that exist under a specified key prefix.  The S3 storage system doesn't *really* have a folder tree, but it fakes one by indexing keys by a delimiter (typically slash).  This method fetches one subfolder level only -- it does not recurse for nested folders.  Example:

```js
try {
	// list remote folders and files
	let { folders, files } = await s3.listFolders({ remotePath: 's3dir' });
	console.log(folders, files);
}
catch (err) {
	// handle error here
}
```

The `folders` will be an array of subfolder paths, and the `files` are all files from the current folder level (see below).  Note that this API does **not** recurse for nested folders, nor does it paginate beyond 1,000 items.  It is really designed for use in an explorer UI only.

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `remotePath` | String | The base S3 path to look for folders under.  This may be prepended with a `prefix` if set on the class instance. |
| `delimiter` | String | Optionally override the delimiter for directory indexing.  Defaults to `/`. |
| `bucket` | String | Optionally specify the S3 bucket where the records are stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `folders` | Array | An array of S3 path prefixes for subfolders just under the current level. |
| `files` | Array | An array of file objects at the current folder level.  See below for details. |

The items of the `files` array will contain the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | The object's full S3 key (including prefix if applicable). |
| `size` | Integer | The objects's size in bytes. |
| `mtime` | Integer | The object's modification date, as Epoch seconds. |

### listBuckets

The `listBuckets()` method fetches the complete list of S3 buckets in your AWS account.  It accepts no options.  Example:

```js
try {
	// list buckets
	let { buckets } = await s3.listBuckets();
	console.log(buckets);
}
catch (err) {
	// handle error here
}
```

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `buckets` | Array | An array of S3 bucket names. |

### walk

The `walk()` method fires an interator for every remote S3 object that exists under a specified key prefix, and optionally match a specified filter.  It will automatically loop and paginate as required.  The iterator is fired as a synchronous call.  Example:

```js
try {
	// find remote gif files
	var files = [];
	await s3.walk({ remotePath: 's3dir', iterator: function(file) { files.push(file); } });
	console.log(files);
}
catch (err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `remotePath` | String | The base S3 path to look for files under.  This may be prepended with a `prefix` if set on the class instance. |
| `filespec` | RegExp | Optionally filter the result files using a regular expression, matched on the filenames. |
| `filter` | Function | Optionally provide a filter function to select which files to return. |
| `iterator` | Function | A synchronous function that is called for every remote S3 file.  It is passed an object containing file metadata (see below). |
| `older` | Number | Optionally filter the S3 files based on their modification date, i.e. they must be older than the specified number of seconds.  You can also specify a string here, e.g. "7 days". |
| `bucket` | String | Optionally specify the S3 bucket where the records are stored.  This is usually set in the class constructor. |

Each item object passed to the iterator will contain the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | The object's full S3 key (including prefix if applicable). |
| `size` | Integer | The objects's size in bytes. |
| `mtime` | Integer | The object's modification date, as Epoch seconds. |

### copy

The `copy()` method copies one S3 object to another location.  This API can copy between buckets as well.  Example:

```js
try {
	// copy an object
	let { meta } = await s3.copy({ sourceKey: 'users/oldkermit', key: 'users/newkermit' });
}
catch(err) {
	// handle error here
}
```

To copy an object between buckets, include a `sourceBucket` property.  The destination bucket is always specified via `bucket` (which may be set on your class instance or in the copy API).  Example:

```js
try {
	// copy an object between buckets
	let { meta } = await s3.copy({ sourceBucket: 'oldbucket', sourceKey: 'users/oldkermit', bucket: 'newbucket', key: 'users/newkermit' });
}
catch(err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `sourceKey` | String | **(Required)** The S3 key to copy from.  This may be prepended with a `prefix` if set on the class instance. |
| `key` | String | **(Required)** The S3 key to copy the object to.  This may be prepended with a `prefix` if set on the class instance. |
| `sourceBucket` | String | Optionally override the S3 bucket used to read the source record.  This defaults to the class `bucket` parameter. |
| `bucket` | String | Optionally override the S3 bucket used to store the destination record.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

### move

The `move()` method moves one S3 object to another location.  Essentially, it performs a [copy()](#copy) followed by a [delete()](#delete).  This can move objects between buckets as well.  Example:

```js
try {
	// move an object
	let { meta } = await s3.move({ sourceKey: 'users/oldkermit', key: 'users/newkermit' });
}
catch(err) {
	// handle error here
}
```

To move an object between buckets, use `sourceBucket`.  The destination bucket is always specified via `bucket` (which may be set on your class instance or in the copy API).  Example:

```js
try {
	// move an object between buckets
	let { meta } = await s3.move({ sourceBucket: 'oldbucket', sourceKey: 'users/oldkermit', bucket: 'newbucket', key: 'users/newkermit' });
}
catch(err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `sourceKey` | String | **(Required)** The S3 key to move from.  This may be prepended with a `prefix` if set on the class instance. |
| `key` | String | **(Required)** The S3 key to move the object to.  This may be prepended with a `prefix` if set on the class instance. |
| `sourceBucket` | String | Optionally override the S3 bucket used to read the source record.  This defaults to the class `bucket` parameter. |
| `bucket` | String | Optionally override the S3 bucket used to store the destination record.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

### delete

The `delete()` method deletes a single object from S3 given its key.  Please use caution here, as there is no way to undo a delete -- we don't use versioned buckets.  Example:

```js
try {
	// delete a remote object
	let { meta } = await s3.delete({ key: 's3dir/myfile.gif' });
}
catch (err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | **(Required)** The S3 key of the object you want to delete.  This may be prepended with a `prefix` if set on the class instance. |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

**Note:** This will also remove the object from the [Cache](#caching), if enabled.

### uploadFile

The `uploadFile()` method uploads a file from the local filesystem to an object in S3.  This uses streams and multi-part uploads in the background, so it can handle files of any size while using very little memory.  Example:

```js
try {
	// upload file
	let { meta } = await s3.uploadFile({ localFile: '/path/to/image.gif', key: 's3dir/myfile.gif' });
}
catch(err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `localFile` | String | **(Required)** A path to the file on local disk. |
| `key` | String | **(Required)** The S3 key of the object.  This may be prepended with a `prefix` if set on the class instance. |
| `compress` | Boolean | Set this to `true` to automatically compress the file during upload.  Defaults to `false`.  See [Compression](#compression). |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

Note that you can omit the filename portion of the `key` property if you want.  Specifically, if the `key` ends with a slash (`/`) this will trigger the library to automatically append the local filename to the end of the S3 key.

### downloadFile

The `downloadFile()` method downloads an object from S3, and saves it to a local file on disk.  The local file's parent directories will be automatically created if needed.  This uses streams in the background, so it can handle files of any size while using very little memory.  Example:

```js
try {
	// download file
	let { meta } = await s3.downloadFile({ key: 's3dir/myfile.gif', localFile: '/path/to/image.gif' });
}
catch(err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | **(Required)** The S3 key of the object to download.  This may be prepended with a `prefix` if set on the class instance. |
| `localFile` | String | **(Required)** A path to the destination file on local disk. |
| `decompress` | Boolean | Set this to `true` to automatically decompress the file during download.  Defaults to `false`.  See [Compression](#compression). |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

Note that you can omit the filename portion of the `localFile` property if you want.  Specifically, if the `localFile` ends with a slash (`/`) this will trigger the library to automatically append the filename from the S3 key.

### uploadFiles

The `uploadFiles()` method recursively uploads multiple files / directories from the local filesystem to S3.  This uses streams and multi-part uploads in the background, so it can handle files of any size while using very little memory.  Example:

```js
try {
	// upload selected files
	let { files } = await s3.uploadFiles({ localPath: '/path/to/images', remotePath: 's3dir/uploadedimages', filespec: /\.gif$/ });
}
catch(err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `localPath` | String | **(Required)** The base filesystem path to find files under.  Should resolve to a folder. |
| `remotePath` | String | **(Required)** The base S3 path to store files under.  This may be prepended with a `prefix` if set on the class instance. |
| `filespec` | RegExp | Optionally filter the local files using a regular expression, applied to the filenames. |
| `threads` | Integer | Optionally increase the threads to improve performance (don't combine with `compress`). |
| `compress` | Boolean | Set this to `true` to automatically compress all files during upload.  Defaults to `false`.  See [Compression](#compression). |
| `suffix` | String | Optionally append a suffix to every destination S3 key, e.g. `.gz` for compressed files. |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `files` | Array | An array of files that were uploaded.  Each item in the array is a string containing the file path. |

### downloadFiles

The `downloadFiles()` method recursively downloads multiple files / directories from S3 to the local filesystem.  Local parent directories will be automatically created if needed.  This uses streams in the background, so it can handle files of any size while using very little memory.  Example:

```js
try {
	// download selected files
	let { files, bytes } = await s3.downloadFiles({ remotePath: 's3dir/uploadedimages', localPath: '/path/to/images', filespec: /\.gif$/ });
}
catch(err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `remotePath` | String | **(Required)** The base S3 path to fetch files from.  This may be prepended with a `prefix` if set on the class instance. |
| `localPath` | String | **(Required)** The local filesystem path to save files under.  Parent directories will automatically be created if needed. |
| `filespec` | RegExp | Optionally filter the S3 files using a regular expression, matched on the filenames. |
| `threads` | Integer | Optionally increase the threads to improve performance (don't combine with `decompress`). |
| `decompress` | Boolean | Set this to `true` to automatically decompress all files during download.  Defaults to `false`.  See [Compression](#compression). |
| `strip` | RegExp | Optionally strip a suffix from every destination filename, e.g. `/\.gz$/` to strip the `.gz.` suffix off compressed files. |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `files` | Array | An array of files that were downloaded.  Each item in the array is an object with `key`, `size` and `mtime` properties. |
| `bytes` | Integer | The total number of bytes downloaded. |

### deleteFiles

The `deleteFiles()` method recursively deletes multiple files / directories from S3.  Please use extreme caution here, as there is no way to undo deletes -- we don't use versioned buckets.  Example:

```js
try {
	// delete selected files
	let { files, bytes } = await s3.deleteFiles({ remotePath: 's3dir/uploadedimages', filespec: /\.gif$/ });
}
catch(err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `remotePath` | String | **(Required)** The base S3 path to delete files from.  This may be prepended with a `prefix` if set on the class instance. |
| `filespec` | RegExp | Optionally filter the S3 files using a regular expression, matched on the filenames. |
| `older` | Mixed | Optionally filter the S3 files based on their modification date, i.e. must be older than the specified number of seconds.  You can also specify a string here, e.g. "7 days". |
| `threads` | Integer | Optionally increase the threads to improve performance at the cost of additional HTTP connections. |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `files` | Array | An array of files that were deleted.  Each item in the array is an object with `key`, `size` and `mtime` properties. |
| `bytes` | Integer | The total number of bytes deleted. |

### putBuffer

The `putBuffer()` method uploads a Node.js [Buffer](https://nodejs.org/api/buffer.html) to S3, given a key.  Example:

```js
let buf = fs.readFileSync( '/path/to/image.gif' );

try {
	// upload buffer
	let { meta } = await s3.putBuffer({ key: 's3dir/myfile.gif', value: buf });
}
catch (err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | **(Required)** The S3 key to store the object under.  This may be prepended with a `prefix` if set on the class instance. |
| `value` | Buffer | **(Required)** The buffer value to store. |
| `compress` | Boolean | Set this to `true` to automatically compress the buffer during upload.  Defaults to `false`.  See [Compression](#compression). |
| `bucket` | String | Optionally override the S3 bucket used to store the record.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

### getBuffer

The `getBuffer()` method fetches an S3 object, and returns a Node.js [Buffer](https://nodejs.org/api/buffer.html).  Beware of memory utilization with large objects, as buffers are stored entirely in memory.  Example:

```js
try {
	// download buffer
	let { data } = await s3.getBuffer({ key: 's3dir/myfile.gif' });
}
catch (err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | **(Required)** The S3 key of the object you want to get.  This may be prepended with a `prefix` if set on the class instance. |
| `decompress` | Boolean | Set this to `true` to automatically decompress the buffer during download.  Defaults to `false`.  See [Compression](#compression). |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `data` | Buffer | The content of the S3 record, in buffer format. |
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

### putStream

The `putStream()` method uploads a Node.js [Stream](https://nodejs.org/api/stream.html) to S3, given a key.  Example:

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

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | **(Required)** The S3 key to store the object under.  This may be prepended with a `prefix` if set on the class instance. |
| `value` | Stream | **(Required)** The Node.js stream to upload. |
| `compress` | Boolean | Set this to `true` to automatically compress the stream during upload.  Defaults to `false`.  See [Compression](#compression). |
| `bucket` | String | Optionally override the S3 bucket used to store the record.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

### getStream

The `getStream()` method fetches an S3 object, and returns a Node.js [readable stream](https://nodejs.org/api/stream.html#readable-streams) for handling in your code.  Specifically, the data is not downloaded in the scope of the API call -- a stream is merely started.  You are expected to handle the stream yourself, i.e. pipe it to another stream, or read chunks off it by hand.  Here is an example of piping it to a file:

```js
let writeStream = fs.createWriteStream( '/path/to/image.gif' );

try {
	// start stream from S3
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

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | **(Required)** The S3 key of the object you want to get.  This may be prepended with a `prefix` if set on the class instance. |
| `decompress` | Boolean | Set this to `true` to automatically decompress the stream during download.  Defaults to `false`.  See [Compression](#compression). |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `data` | Stream | The stream of the S3 contents, ready for piping. |
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

# License

**The MIT License (MIT)**

*Copyright (c) 2023 Joseph Huckaby.*

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
