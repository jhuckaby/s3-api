# API Reference

This document contains a complete API reference for **s3-api**.

## Table of Contents

> &larr; [Return to the main document](https://github.com/jhuckaby/s3-api/blob/main/README.md)

<!-- toc -->
- [Class Methods](#class-methods)
	* [constructor](#constructor)
	* [attachLogAgent](#attachlogagent)
	* [attachPerfAgent](#attachperfagent)
	* [put](#put)
	* [update](#update)
	* [get](#get)
	* [head](#head)
	* [list](#list)
	* [listFolders](#listfolders)
	* [listBuckets](#listbuckets)
	* [grepFiles](#grepfiles)
	* [walk](#walk)
	* [copyFile](#copyfile)
	* [copyFiles](#copyfiles)
	* [moveFile](#movefile)
	* [moveFiles](#movefiles)
	* [deleteFile](#deletefile)
	* [deleteFiles](#deletefiles)
	* [uploadFile](#uploadfile)
	* [uploadFiles](#uploadfiles)
	* [downloadFile](#downloadfile)
	* [downloadFiles](#downloadfiles)
	* [putBuffer](#putbuffer)
	* [getBuffer](#getbuffer)
	* [putStream](#putstream)
	* [getStream](#getstream)

## Class Methods

### constructor

The class constructor accepts an object containing configuration properties.  The following properties are available:

| Property Name | Type | Description |
|---------------|------|-------------|
| `credentials` | Object | Your AWS credentials (containing `accessKeyId` and `secretAccessKey`) if required. |
| `region` | String | The AWS region to use for the S3 API.  Defaults to `us-west-1`. |
| `bucket` | String | The S3 bucket to use by default.  You can optionally override this per API call. |
| `prefix` | String | An optional prefix to prepend onto all S3 keys.  Useful for keeping all of your app's keys under a common prefix. |
| `params` | Object | An optional object to set S3 object metadata.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |
| `gzip` | Object | Optionally configure the gzip compression settings.  See [Compression](https://github.com/jhuckaby/s3-api/blob/main/README.md#compression). |
| `timeout` | Integer | The number of milliseconds to wait before killing idle sockets.  The default is `5000` (5 seconds). |
| `connectTimeout` | Integer | The number of milliseconds to wait when initially connecting to S3.  The default is `5000` (5 seconds). |
| `retries` | Integer | The number of retries to attempt before failing each request.  The default is `50`.  Exponential backoff is included. |
| `logger` | Object | Optionally pass in a [pixl-logger](https://github.com/jhuckaby/pixl-logger) compatible logger here.  Or use [attachLogAgent()](#attachlogagent). |
| `perf` | Object | Optionally pass in a [pixl-perf](https://github.com/jhuckaby/pixl-perf) compatible perf tracker here.  Or use [attachPerfAgent()](#attachperfagent). |
| `cache` | Object | Optionally enable caching for JSON records.  See [Caching](https://github.com/jhuckaby/s3-api/blob/main/README.md#caching) for details. |
| `dry` | Boolean | Optionally enable "dry-run" mode, which will take no actual actions against S3 or the local filesystem. |

The following advanced properties should only be needed if you are connecting to a custom S3 endpoint, or a non-AWS S3 provider:

| Property Name | Type | Description |
|---------------|------|-------------|
| `endpoint` | String | The custom S3 endpoint URL, e.g. `http://MINIO_HOST:9000`. |
| `forcePathStyle` | Boolean | Whether to force path style URLs for S3 objects.  This should typically be set to `true` for non-AWS S3 providers. |

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

See [Logging](https://github.com/jhuckaby/s3-api/blob/main/README.md#logging) for details on what is logged.

### attachPerfAgent

The `attachPerfAgent()` method allows you to attach a [pixl-perf](https://github.com/jhuckaby/pixl-perf) compatible performance tracker to your API class.  It will measure all calls to S3.  Example use:

```js
s3.attachPerfAgent( perf );
```

See [Performance Tracking](https://github.com/jhuckaby/s3-api/blob/main/README.md#performance-tracking) for details on what is tracked.

### put

The `put()` method stores an object as a JSON-serialized record in S3, treating it like a key/value store.  Example:

```js
try {
	// store a record
	let { meta } = await s3.put({ 
		key: 'users/kermit.json', 
		value: { animal: 'frog', color: 'green' } 
	});
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
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

### update

The `update()` method updates a JSON-serialized record in S3, by selectively setting values using dot.path.notation.  You can add, replace or delete individual JSON properties in this way.  This will first [get()](#get) the record, apply the updates, then [put()](#put) it back to S3.  Example:

```js
try {
	// update a record
	let { data } = await s3.update({ 
		key: 'users/kermit.json', 
		updates: { animal: 'toad', color: undefined, newkey: 'newvalue' } 
	});
	console.log(data); // { "animal": "frog", "newkey": "newvalue" }
}
catch(err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | **(Required)** The S3 key of the record to update.  This may be prepended with a `prefix` if set on the class instance. |
| `updates` | Object | **(Required)** An object containing JSON paths and values to update.  See below for details. |
| `pretty` | Boolean | Optionally serialize the JSON using "pretty-printing" (formatting with multiple lines and tab indentations) by setting this to `true`.  The default is `false`. |
| `bucket` | String | Optionally override the S3 bucket used to store the record.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `data` | Object | The full updated JSON record, after all updates applied. |

As you can see in the above example, you can replace properties (e.g. `animal`), delete properties (e.g. `color` -- set the value to `undefined` to delete it), and add new ones (e.g. `newkey`).  You can also do this to sub-properties nested inside of objects, and even create new objects during the update.  To do this, use dot.path.notation for the update keys.  To illustrate, consider a pre-existing JSON record with this content:

```json
{
	"username": "fsmith",
	"realName": "Fred Smith",
	"email": "fred@smith.com",
	"privileges": {
		"createRecords": true,
		"deleteRecords": false
	}
}
```

Now, let's see what we can do with a call to `update()`:

```js
try {
	let { data } = await s3.update({ 
		key: 'users/fsmith.json', 
		updates: {
			"email": "fsmith@email.com",
			"privileges.deleteRecords": true
			"privileges.calendar": true
		} 
	});
}
catch(err) {
	// handle error here
}
```

This update would replace two properties in the user record, and add one new one, resulting in this final form:

```json
{
	"username": "fsmith",
	"realName": "Fred Smith",
	"email": "fsmith@email.com",
	"privileges": {
		"createRecords": true,
		"deleteRecords": true,
		"calendar": true
	}
}
```

Notice that we modified two nested sub-properties inside the "privileges" object by using dot.path.notation, e.g. `privileges.deleteRecords`.  You can also create new objects by simply using dot.path.notation to walk inside a non-existent object.  Finally, you can walk into and modify arrays using numbered indexes.

### get

The `get()` method fetches an object that was written in JSON format (e.g. from [put()](#put), or it can just be a JSON file that was uploaded to S3), and parses the JSON for you.  Example:

```js
try {
	// fetch a record
	let { data } = await s3.get({ key: 'users/kermit.json' });
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
| `subpath` | String | Optionally fetch a subpath (nested object) using dot.path.notation, instead of the entire JSON record. |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `data` | Object | The content of the JSON record, parsed and in object format. |
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

**Notes:** 

- When [Caching](https://github.com/jhuckaby/s3-api/blob/main/README.md#caching) is enabled and an object is fetched from the cache, the `meta` response object will simply contain a single `cached` property, set to `true`.

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

**Notes:** 

- The `head()` method bypasses the [Cache](https://github.com/jhuckaby/s3-api/blob/main/README.md#caching).  It always hits S3.

### list

The `list()` method fetches a listing of remote S3 objects that exist under a specified key prefix, and optionally match a specified filter.  It will automatically loop and paginate as required, returning the full set of matched objects regardless of length.  Example:

```js
try {
	// list remote gif files
	let { files, bytes } = await s3.list({ 
		remotePath: 's3dir/', 
		filespec: /\.gif$/ 
	});
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

**Notes:** 

- Always include a trailing slash when specifying directories.

### listFolders

The `listFolders()` method fetches a listing of remote S3 files and "subfolders" that exist under a specified key prefix.  The S3 storage system doesn't *really* have a folder tree, but it fakes one by indexing keys by a delimiter (typically slash).  This method fetches one subfolder level only -- it does not recurse for nested folders.  Example:

```js
try {
	// list remote folders and files
	let { folders, files } = await s3.listFolders({ remotePath: 's3dir/' });
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
| `bucket` | String | Optionally specify the S3 bucket where the folders reside.  This is usually set in the class constructor. |

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

**Notes:** 

- Always include a trailing slash when specifying directories.

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

### grepFiles

The `grepFiles()` method fires an iterator function for *every line* inside every remote S3 object that exists under a specified key prefix, and optionally match a specified filter.  It will automatically loop and paginate as required.  The iterator is fired as a synchronous call.  Example:

```js
try {
	// find matching lines inside remote log files
	await s3.grepFiles({ 
		remotePath: 's3dir/logfiles/', 
		filespec: /\.log\.gz$/,
		match: /Incoming Request/,
		decompress: true,
		
		iterator: function(line, file) {
			console.log("Matched line! ", line, file);
		} 
	});	
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
| `filter` | Function | Optionally provide a filter function to select which files to grep. |
| `older` | Number | Optionally filter the S3 files based on their modification date, i.e. they must be *older* than the specified date/time or relative time, e.g. "7 days". |
| `newer` | Number | Optionally filter the S3 files based on their modification date, i.e. they must be *newer* than the specified date/time or relative time, e.g. "7 days". |
| `match` | RegExp | Optionally filter lines to only those matching the provided regular expression. |
| `iterator` | Function | A synchronous function that is called for every matched line.  It is passed the line as a string, and an object containing file metadata (see below). |
| `decompress` | Boolean | Automatically decompress all files using gunzip during download.  Disabled by default. |
| `maxLines` | Number | Optionally limit the number of matched lines to the specified value. |
| `threads` | Integer | Optionally increase concurrency to improve performance.  Defaults to `1` thread. |
| `bucket` | String | Optionally specify the S3 bucket where the records are stored.  This is usually set in the class constructor. |

Each item object passed to the iterator will contain the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `key` | String | The object's full S3 key (including prefix if applicable). |
| `size` | Integer | The objects's size in bytes. |
| `mtime` | Integer | The object's modification date, as Epoch seconds. |

**Notes:** 

- Always include a trailing slash when specifying directories.
- You can abort a grep in progress by returning `false` from your iterator function.
- Files are streamed and [line-read](https://nodejs.org/api/readline.html#readline), so very little memory will be used, even for huge files, and even for compressed files.

### walk

The `walk()` method fires an iterator function for every remote S3 object that exists under a specified key prefix, and optionally match a specified filter.  It will automatically loop and paginate as required.  The iterator is fired as a synchronous call.  Example:

```js
try {
	// find remote gif files
	let files = [];
	
	await s3.walk({ 
		remotePath: 's3dir/', 
		iterator: function(file) { files.push(file); } 
	});
	
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

**Notes:** 

- Always include a trailing slash when specifying directories.

### copyFile

The `copyFile()` method copies one S3 object to another S3 location.  This API can copy between buckets as well.  Example:

```js
try {
	// copy an object
	let { meta } = await s3.copyFile({ 
		sourceKey: 'users/oldkermit.json', 
		key: 'users/newkermit.json' 
	});
}
catch(err) {
	// handle error here
}
```

To copy an object between buckets, include a `sourceBucket` property.  The destination bucket is always specified via `bucket` (which may be set on your class instance or in the copyFile API).  Example:

```js
try {
	// copy an object between buckets
	let { meta } = await s3.copyFile({ 
		sourceBucket: 'oldbucket', 
		sourceKey: 'users/oldkermit.json', 
		bucket: 'newbucket', 
		key: 'users/newkermit.json' 
	});
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
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

**Notes:** 

- The AWS SDK does not preserve metadata, such as ACL and storage class, when copying objects.

### copyFiles

The `copyFiles()` method recursively copies multiple files / directories from S3 to the another S3 location.  Example:

```js
try {
	// copy selected files
	let { files, bytes } = await s3.copyFiles({ 
		remotePath: 's3dir/uploadedimages/', 
		destPath: 's3dir/copyofimages/', 
		filespec: /\.gif$/ 
	});
}
catch(err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `remotePath` | String | **(Required)** The base S3 path to fetch files from.  This may be prepended with a `prefix` if set on the class instance. |
| `destPath` | String | **(Required)** The base S3 path to copy files to.  This may be prepended with a `prefix` if set on the class instance. |
| `filespec` | RegExp | Optionally filter the S3 files using a regular expression, matched on the filenames. |
| `filter` | Function | Optionally provide a function to decide whether or not to include each file.  See below for usage. |
| `progress` | Function | Optionally provide a progress function, which will be called periodically during the operation.  See below for usage. |
| `threads` | Integer | Optionally increase the threads to improve performance.  Defaults to `1`. |
| `sourceBucket` | String | Optionally override the S3 bucket used to read the source files.  This defaults to the class `bucket` parameter. |
| `bucket` | String | Optionally specify the S3 bucket where the files are copied to.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `files` | Array | An array of files that were copied.  Each item in the array is an object with `key`, `size` and `mtime` properties. |
| `bytes` | Integer | The total number of bytes copied. |

If you specify a `filter` function, it is called for each matching S3 key, and passed an object containing `key`, `size` and `mtime` properties.  Return `true` to copy the file, or `false` to skip it.  Example use:

```js
try {
	// copy selected files
	let { files } = await s3.copyFiles({ 
		remotePath: 's3dir/uploadedimages/', 
		destPath: 's3dir/copyofimages/', 
		
		filter: function(file) {
			// only copy large files 1MB+
			return file.size > 1024 * 1024;
		}
	});
}
catch(err) {
	// handle error here
}
```

If you specify a `progress` function, it will be called periodically with an object containing `loaded` and `total` properties (both are byte counts).  Example use:

```js
try {
	// copy selected files
	let { files } = await s3.copyFiles({ 
		remotePath: 's3dir/uploadedimages/', 
		destPath: 's3dir/copyofimages/', 
		
		progress: function(progress) {
			console.log( `Copied ${progress.loaded} of ${progress.total} bytes.` );
		}
	});
}
catch(err) {
	// handle error here
}
```

**Notes:**

- Always include a trailing slash when specifying directories.
- The AWS SDK does not preserve metadata, such as ACL and storage class, when copying objects.

### moveFile

The `moveFile()` method moves one S3 object to another S3 location.  Essentially, it performs a [copyFile()](#copyfile) followed by a [deleteFile()](#deletefile).  This can move objects between buckets as well.  Example:

```js
try {
	// move an object
	let { meta } = await s3.moveFile({ 
		sourceKey: 'users/oldkermit', 
		key: 'users/newkermit' 
	});
}
catch(err) {
	// handle error here
}
```

To move an object between buckets, use `sourceBucket`.  The destination bucket is always specified via `bucket` (which may be set on your class instance or in the moveFile API).  Example:

```js
try {
	// move an object between buckets
	let { meta } = await s3.moveFile({ 
		sourceBucket: 'oldbucket', 
		sourceKey: 'users/oldkermit', 
		bucket: 'newbucket', 
		key: 'users/newkermit' 
	});
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
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

**Notes:** 

- The AWS SDK does not preserve metadata, such as ACL and storage class, when moving objects.

### moveFiles

The `moveFiles()` method recursively moves multiple files / directories from S3 to the another S3 location.  Example:

```js
try {
	// move selected files
	let { files, bytes } = await s3.moveFiles({ 
		remotePath: 's3dir/uploadedimages/', 
		destPath: 's3dir/copyofimages/', 
		filespec: /\.gif$/ 
	});
}
catch(err) {
	// handle error here
}
```

The method accepts an object containing the following properties:

| Property Name | Type | Description |
|---------------|------|-------------|
| `remotePath` | String | **(Required)** The base S3 path to fetch files from.  This may be prepended with a `prefix` if set on the class instance. |
| `destPath` | String | **(Required)** The base S3 path to move files to.  This may be prepended with a `prefix` if set on the class instance. |
| `filespec` | RegExp | Optionally filter the S3 files using a regular expression, matched on the filenames. |
| `filter` | Function | Optionally provide a function to decide whether or not to include each file.  See below for usage. |
| `progress` | Function | Optionally provide a progress function, which will be called periodically during the operation.  See below for usage. |
| `threads` | Integer | Optionally increase the threads to improve performance.  Defaults to `1`. |
| `sourceBucket` | String | Optionally override the S3 bucket used to read the source files.  This defaults to the class `bucket` parameter. |
| `bucket` | String | Optionally specify the S3 bucket where the files are moved to.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `files` | Array | An array of files that were moved.  Each item in the array is an object with `key`, `size` and `mtime` properties. |
| `bytes` | Integer | The total number of bytes moved. |

If you specify a `filter` function, it is called for each matching S3 key, and passed an object containing `key`, `size` and `mtime` properties.  Return `true` to move the file, or `false` to skip it.  Example use:

```js
try {
	// move selected files
	let { files } = await s3.moveFiles({ 
		remotePath: 's3dir/uploadedimages/', 
		destPath: 's3dir/copyofimages/', 
		
		filter: function(file) {
			// only move large files 1MB+
			return file.size > 1024 * 1024;
		}
	});
}
catch(err) {
	// handle error here
}
```

If you specify a `progress` function, it will be called periodically with an object containing `loaded` and `total` properties (both are byte counts).  Example use:

```js
try {
	// move selected files
	let { files } = await s3.moveFiles({ 
		remotePath: 's3dir/uploadedimages/', 
		destPath: 's3dir/copyofimages/', 
		
		progress: function(progress) {
			console.log( `Moved ${progress.loaded} of ${progress.total} bytes.` );
		}
	});
}
catch(err) {
	// handle error here
}
```

**Notes:** 

- Always include a trailing slash when specifying directories.
- The AWS SDK does not preserve metadata, such as ACL and storage class, when moving objects.

### deleteFile

The `deleteFile()` method deletes a single object from S3 given its key.  Please use caution here, as there is no way to undo a delete (unless you use versioned buckets I suppose).  Example:

```js
try {
	// delete a remote object
	let { meta } = await s3.deleteFile({ key: 's3dir/myfile.gif' });
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

**Notes:**

- This will also remove the object from the [Cache](https://github.com/jhuckaby/s3-api/blob/main/README.md#caching), if enabled.

### deleteFiles

The `deleteFiles()` method recursively deletes multiple files / directories from S3.  Please use extreme caution here, as there is no way to undo deletes (unless you use versioned buckets I suppose).  Example:

```js
try {
	// delete selected files
	let { files, bytes } = await s3.deleteFiles({ 
		remotePath: 's3dir/uploadedimages/', 
		filespec: /\.gif$/ 
	});
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
| `filter` | Function | Optionally provide a function to decide whether or not to delete each file.  See below for usage. |
| `progress` | Function | Optionally provide a progress function, which will be called periodically during the operation.  See below for usage. |
| `older` | Mixed | Optionally filter the S3 files based on their modification date, i.e. must be older than the specified number of seconds.  You can also specify a string here, e.g. "7 days". |
| `threads` | Integer | Optionally increase the threads to improve performance at the cost of additional HTTP connections. |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `files` | Array | An array of files that were deleted.  Each item in the array is an object with `key`, `size` and `mtime` properties. |
| `bytes` | Integer | The total number of bytes deleted. |

If you specify a `filter` function, it is called for each matching S3 key, and passed an object containing `key`, `size` and `mtime` properties.  Return `true` to delete the file, or `false` to skip it.  Example use:

```js
try {
	// delete selected files
	let { files } = await s3.deleteFiles({ 
		remotePath: 's3dir/uploadedimages/', 
		
		filter: function(file) {
			// only delete large files 1MB+
			return file.size > 1024 * 1024;
		}
	});
}
catch(err) {
	// handle error here
}
```

If you specify a `progress` function, it will be called periodically with an object containing `loaded` and `total` properties (both are byte counts).  Example use:

```js
try {
	// delete selected files
	let { files } = await s3.deleteFiles({ 
		remotePath: 's3dir/uploadedimages/', 
		
		progress: function(progress) {
			console.log( `Deleted ${progress.loaded} of ${progress.total} bytes.` );
		}
	});
}
catch(err) {
	// handle error here
}
```

**Notes:** 

- Always include a trailing slash when specifying directories.
- `filter` and `older` are mutually exclusive.  Only one may be provided (the reason is, the `older` feature uses `filter` internally).

### uploadFile

The `uploadFile()` method uploads a file from the local filesystem to an object in S3.  This uses streams and multi-part chunks internally, so it can handle files of any size while using very little memory.  Example:

```js
try {
	// upload file
	let { meta } = await s3.uploadFile({ 
		localFile: '/path/to/image.gif', 
		key: 's3dir/myfile.gif' 
	});
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
| `compress` | Boolean | Set this to `true` to automatically gzip-compress the file during upload.  Defaults to `false`.  See [Compression](https://github.com/jhuckaby/s3-api/blob/main/README.md#compression). |
| `progress` | Function | Optionally provide a progress function, which will be called periodically during the operation.  See below for usage. |
| `delete` | Boolean | Optionally delete the source file after upload is complete. |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

If you specify a `progress` function, it will be called periodically with an object containing `loaded` and `total` properties (both are byte counts).  Example use:

```js
try {
	// upload file
	let { meta } = await s3.uploadFile({ 
		localFile: '/path/to/image.gif', 
		key: 's3dir/myfile.gif',
		
		progress: function(progress) {
			console.log( `Uploaded ${progress.loaded} of ${progress.total} bytes.` );
		}
	});
}
catch(err) {
	// handle error here
}
```

**Notes:** 

- You can omit the filename portion of the `key` property if you want.  Specifically, if the `key` ends with a slash (`/`) this will trigger the library to automatically append the local filename to the end of the S3 key.

### uploadFiles

The `uploadFiles()` method recursively uploads multiple files / directories from the local filesystem to S3.  This uses streams and multi-part uploads internally, so it can handle files of any size while using very little memory.  Example:

```js
try {
	// upload selected files
	let { files } = await s3.uploadFiles({ 
		localPath: '/path/to/images/', 
		remotePath: 's3dir/uploadedimages/', 
		filespec: /\.gif$/ 
	});
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
| `filter` | Function | Optionally provide a function to decide whether or not to include each file.  See below for usage. |
| `all` | Boolean | Optionally include dotfiles (filenames that begin with a period) in the upload (the default is to skip them). |
| `threads` | Integer | Optionally increase the threads to improve performance.  Defaults to `1`. |
| `compress` | Boolean | Set this to `true` to automatically gzip-compress all files during upload.  Defaults to `false`.  See [Compression](https://github.com/jhuckaby/s3-api/blob/main/README.md#compression). |
| `suffix` | String | Optionally append a suffix to every destination S3 key, e.g. `.gz` for compressed files. |
| `progress` | Function | Optionally provide a progress function, which will be called periodically during the operation.  See below for usage. |
| `delete` | Boolean | Optionally delete the source files after upload is complete. |
| `bucket` | String | Optionally specify the S3 bucket where the files should be uploaded.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `files` | Array | An array of files that were uploaded.  Each item in the array is a string containing the file path. |

If you specify a `filter` function, it is called for each file, and passed the file path, and a [fs.Stats](https://nodejs.org/api/fs.html#class-fsstats) object.  Return `true` to upload the file, or `false` to skip it.  Example use:

```js
try {
	// upload selected files
	let { files } = await s3.uploadFiles({ 
		localPath: '/path/to/images/', 
		remotePath: 's3dir/uploadedimages/', 
		
		filter: function(file, stats) {
			// only include large files 1MB+
			return stats.size > 1024 * 1024;
		}
	});
}
catch(err) {
	// handle error here
}
```

If you specify a `progress` function, it will be called periodically with an object containing `loaded` and `total` properties (both are byte counts).  Example use:

```js
try {
	// upload selected files
	let { files } = await s3.uploadFiles({ 
		localPath: '/path/to/images/', 
		remotePath: 's3dir/uploadedimages/', 
		
		progress: function(progress) {
			console.log( `Uploaded ${progress.loaded} of ${progress.total} bytes.` );
		}
	});
}
catch(err) {
	// handle error here
}
```

**Notes:** 

- Always include a trailing slash when specifying directories.

### downloadFile

The `downloadFile()` method downloads an object from S3, and saves it to a local file on disk.  The local file's parent directories will be automatically created if needed.  This uses streams internally, so it can handle files of any size while using very little memory.  Example:

```js
try {
	// download file
	let { meta } = await s3.downloadFile({ 
		key: 's3dir/myfile.gif', 
		localFile: '/path/to/image.gif' 
	});
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
| `decompress` | Boolean | Set this to `true` to automatically decompress the file during download.  Defaults to `false`.  See [Compression](https://github.com/jhuckaby/s3-api/blob/main/README.md#compression). |
| `progress` | Function | Optionally provide a progress function, which will be called periodically during the operation.  See below for usage. |
| `delete` | Boolean | Optionally delete the S3 file after download is complete. |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

If you specify a `progress` function, it will be called periodically with an object containing `loaded` and `total` properties (both are byte counts).  Example use:

```js
try {
	// download file
	let { meta } = await s3.downloadFile({ 
		key: 's3dir/myfile.gif',
		localFile: '/path/to/image.gif', 
		
		progress: function(progress) {
			console.log( `Downloaded ${progress.loaded} of ${progress.total} bytes.` );
		}
	});
}
catch(err) {
	// handle error here
}
```

**Notes:** 

- You can omit the filename portion of the `localFile` property if you want.  Specifically, if the `localFile` ends with a slash (`/`) this will trigger the library to automatically append the filename from the S3 key.

### downloadFiles

The `downloadFiles()` method recursively downloads multiple files / directories from S3 to the local filesystem.  Local parent directories will be automatically created if needed.  This uses streams internally, so it can handle files of any size while using very little memory.  Example:

```js
try {
	// download selected files
	let { files, bytes } = await s3.downloadFiles({ 
		remotePath: 's3dir/uploadedimages/', 
		localPath: '/path/to/images/', 
		filespec: /\.gif$/ 
	});
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
| `filter` | Function | Optionally provide a function to decide whether or not to include each file.  See below for usage. |
| `threads` | Integer | Optionally increase the threads to improve performance.  Defaults to `1`. |
| `decompress` | Boolean | Set this to `true` to automatically decompress all files during download.  Defaults to `false`.  See [Compression](https://github.com/jhuckaby/s3-api/blob/main/README.md#compression). |
| `strip` | RegExp | Optionally strip a suffix from every destination filename, e.g. `/\.gz$/` to strip the `.gz` suffix off compressed files. |
| `progress` | Function | Optionally provide a progress function, which will be called periodically during the operation.  See below for usage. |
| `delete` | Boolean | Optionally delete the S3 files after download is complete. |
| `bucket` | String | Optionally specify the S3 bucket where the files are stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `files` | Array | An array of files that were downloaded.  Each item in the array is an object with `key`, `size` and `mtime` properties. |
| `bytes` | Integer | The total number of bytes downloaded. |

If you specify a `filter` function, it is called for each matching S3 key, and passed an object containing `key`, `size` and `mtime` properties.  Return `true` to download the file, or `false` to skip it.  Example use:

```js
try {
	// download selected files
	let { files } = await s3.downloadFiles({ 
		remotePath: 's3dir/uploadedimages/', 
		localPath: '/path/to/images/', 
		
		filter: function(file) {
			// only download large files 1MB+
			return file.size > 1024 * 1024;
		}
	});
}
catch(err) {
	// handle error here
}
```

If you specify a `progress` function, it will be called periodically with an object containing `loaded` and `total` properties (both are byte counts).  Example use:

```js
try {
	// download selected files
	let { files } = await s3.downloadFiles({ 
		remotePath: 's3dir/uploadedimages/', 
		localPath: '/path/to/images/', 
		
		progress: function(progress) {
			console.log( `Downloaded ${progress.loaded} of ${progress.total} bytes.` );
		}
	});
}
catch(err) {
	// handle error here
}
```

**Notes:** 

- Always include a trailing slash when specifying directories.

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
| `compress` | Boolean | Set this to `true` to automatically gzip-compress the buffer during upload.  Defaults to `false`.  See [Compression](https://github.com/jhuckaby/s3-api/blob/main/README.md#compression). |
| `progress` | Function | Optionally provide a progress function, which will be called periodically during the operation.  See below for usage. |
| `bucket` | String | Optionally override the S3 bucket used to store the record.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

If you specify a `progress` function, it will be called periodically with an object containing `loaded` and `total` properties (both are byte counts).  Example use:

```js
let buf = fs.readFileSync( '/path/to/image.gif' );

try {
	// upload buffer
	let { meta } = await s3.putBuffer({ 
		key: 's3dir/myfile.gif', 
		value: buf,
		
		progress: function(progress) {
			console.log( `Sent ${progress.loaded} of ${progress.total} bytes.` );
		}
	});
}
catch (err) {
	// handle error here
}
```

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
| `decompress` | Boolean | Set this to `true` to automatically decompress the buffer during download.  Defaults to `false`.  See [Compression](https://github.com/jhuckaby/s3-api/blob/main/README.md#compression). |
| `progress` | Function | Optionally provide a progress function, which will be called periodically during the operation.  See below for usage. |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `data` | Buffer | The content of the S3 record, in buffer format. |
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

If you specify a `progress` function, it will be called periodically with an object containing `loaded` and `total` properties (both are byte counts).  Example use:

```js
try {
	// download buffer
	let { data } = await s3.getBuffer({ 
		key: 's3dir/myfile.gif',
		
		progress: function(progress) {
			console.log( `Received ${progress.loaded} of ${progress.total} bytes.` );
		}
	});
}
catch (err) {
	// handle error here
}
```

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
| `compress` | Boolean | Set this to `true` to automatically gzip-compress the stream during upload.  Defaults to `false`.  See [Compression](https://github.com/jhuckaby/s3-api/blob/main/README.md#compression). |
| `progress` | Function | Optionally provide a progress function, which will be called periodically during the operation.  See below for usage. |
| `bucket` | String | Optionally override the S3 bucket used to store the record.  This is usually set in the class constructor. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

If you specify a `progress` function, it will be called periodically with an object containing `loaded` and `total` properties (both are byte counts).  Example use:

```js
let readStream = fs.createReadStream( '/path/to/image.gif' );

try {
	// upload stream to S3
	await s3.putStream({ 
		key: 's3dir/myfile.gif', 
		value: readStream,
		
		progress: function(progress) {
			console.log( `Sent ${progress.loaded} of ${progress.total} bytes.` );
		}
	});
}
catch (err) {
	// handle error here
}
```

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
| `decompress` | Boolean | Set this to `true` to automatically decompress the stream during download.  Defaults to `false`.  See [Compression](https://github.com/jhuckaby/s3-api/blob/main/README.md#compression). |
| `progress` | Function | Optionally provide a progress function, which will be called periodically during the operation.  See below for usage. |
| `bucket` | String | Optionally specify the S3 bucket where the record is stored.  This is usually set in the class constructor. |

The response object will contain the following keys, which you can destruct into variables as shown above:

| Property Name | Type | Description |
|---------------|------|-------------|
| `data` | Stream | The stream of the S3 contents, ready for piping. |
| `meta` | Object | A raw metadata object that is sent back from the AWS S3 service.  It contains information about the request, used for debugging and troubleshooting purposes. |

If you specify a `progress` function, it will be called periodically with an object containing `loaded` and `total` properties (both are byte counts).  Example use:

```js
let writeStream = fs.createWriteStream( '/path/to/image.gif' );

try {
	// start stream from S3
	let { data } = await s3.getStream({ 
		key: 's3dir/myfile.gif',
		
		progress: function(progress) {
			console.log( `Received ${progress.loaded} of ${progress.total} bytes.` );
		}
	});
	
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
