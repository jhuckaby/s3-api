# CLI Reference

This document contains a complete CLI command reference for the **s3-api** library.  Please make sure to read the [CLI Usage Guide](https://github.com/jhuckaby/s3-api/blob/main/README.md#cli-usage) first, for instructions on how to install and configure the CLI.

Please note that the standard [AWS S3 CLI](https://docs.aws.amazon.com/cli/latest/reference/s3/) is a much more feature-rich (not to mentioned battle-hardened) tool, and you should consider using that instead.  This module is a simplified wrapper that only supports basic S3 commands.

## Table of Contents

> &larr; [Return to the main document](https://github.com/jhuckaby/s3-api/blob/main/README.md)

<!-- toc -->
- [Common Arguments](#common-arguments)
	* [Credentials](#credentials)
	* [S3 Params](#s3-params)
		+ [S3 Metadata](#s3-metadata)
	* [Compression](#compression)
- [Commands](#commands)
	* [help](#help)
	* [docs](#docs)
	* [put](#put)
	* [update](#update)
	* [get](#get)
	* [getStream](#getstream)
	* [putStream](#putstream)
	* [head](#head)
	* [list](#list)
	* [listFolders](#listfolders)
	* [listBuckets](#listbuckets)
	* [grep](#grep)
	* [copy](#copy)
	* [copyFile](#copyfile)
	* [copyFiles](#copyfiles)
	* [move](#move)
	* [moveFile](#movefile)
	* [moveFiles](#movefiles)
	* [deleteFile](#deletefile)
	* [deleteFiles](#deletefiles)
	* [uploadFile](#uploadfile)
	* [uploadFiles](#uploadfiles)
	* [downloadFile](#downloadfile)
	* [downloadFiles](#downloadfiles)
	* [snapshot](#snapshot)
	* [restoreSnapshot](#restoresnapshot)
	* [backup](#backup)
	* [restoreBackup](#restorebackup)

## Common Arguments

The following command-line arguments are shared across multiple commands:

| Argument | Type | Description |
|----------|------|-------------|
| `region` | String | Set the AWS region, which defaults to `us-west-1`. |
| `credentials` | Object | Optionally specify your AWS credentials on the command-line.  See [Credentials](#credentials) below. |
| `prefix` | String | Optionally prefix all S3 keys with a fixed value. |
| `params` | Object | Optionally pass custom parameters directly to the AWS API.  See [S3 Params](#s3-params) below. |
| `acl` | String | Alias for `params.ACL`.  See [S3 Params](#s3-params) below. |
| `class` | String | Alias for `params.StorageClass`.  [S3 Params](#s3-params) below. |
| `gzip` | Object | Optionally customize the gzip compression settings.  See [Compression](#compression) below. |
| `timeout` | Integer | The number of milliseconds to wait before killing idle sockets.  The default is `5000` (5 seconds). |
| `connectTimeout` | Integer | The number of milliseconds to wait when initially connecting to S3.  The default is `5000` (5 seconds). |
| `retries` | Integer | The number of retries to attempt before failing each request.  The default is `50`.  Exponential backoff is included. |
| `tempDir` | String | Optionally customize the temp directory used by snapshots and backups. |
| `log` | String | Optionally log all output, including debug information, to a timestamped file. |
| `color` (`c`) | Boolean | Set this to `false` to disable all ANSI color in the console output. |
| `pretty` (`p`) | Boolean | Optionally pretty-print JSON records and output.  Used by [put](#put), [update](#update) and [get](#get). |
| `quiet` (`q`) | Boolean | Suppress all output entirely (except for commands like [get](#get)). |
| `verbose` (`v`) | Boolean | Enable extra verbose output, for informational or troubleshooting purposes. |
| `dry` (`d`) | Boolean | Optionally enable "dry-run" mode, which will take no actual actions against S3 or the local filesystem. |
| `recursive` (`r`) | Boolean | Switch [copyFile](#copyfile), [moveFile](#movefile), [deleteFile](#deletefile), [uploadFile](#uploadfile) and [downloadFile](#downloadfile) into their multi-file equivalents. |

These arguments should all be specified using a double-dash prefix, e.g. `--region us-west-1`.

### Credentials

To authenticate with AWS, you have several options.  First, if you are using an EC2 instance, you can set up automatic auth using the EC2 metadata system, which the AWS SDK supports.  Or, you can have a `~/.aws/credentials` file, which the AWS SDK auto-detects.  Or, you can specify your credentials in the [CLI config file](https://github.com/jhuckaby/s3-api/blob/main/README.md#config-file).  If all of that fails, you can specify your credentials on the command-line like this:

```sh
s3 get s3://my-bucket/users/kermit.json --credentials.accessKeyId "YOUR_ACCESS_KEY_HERE" --credentials.secretAccessKey "YOUR_SECRET_KEY_HERE"
```

However, note that authenticating on the command-line is discouraged, because your secrets will be logged in your terminal / shell command history.  Please use with caution.

### S3 Params

All of the upload related commands (i.e. [put](#put), [update](#update), [copyFile](#copyfile), [moveFile](#movefile), [uploadFile](#uploadfile) and [uploadFiles](#uploadfiles)) accept an optional `--params` argument.  This allows you specify options that are passed directly to the AWS S3 API, for things like ACL and Storage Class.  Example:

```sh
s3 upload /path/to/image.gif s3://my-bucket/s3dir/myfile.gif --params.ACL "public-read" --params.StorageClass "STANDARD_IA"
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

If you are uploading files to a S3 bucket that is hosting a static website, then you can use `--params` to bake in headers like `Content-Type` and `Cache-Control`.  Example:

```sh
s3 upload /path/to/image.gif s3://my-bucket/s3dir/myfile.gif --params.ContentType "image/gif" --params.CacheControl "max-age=86400"
```

You can alternatively declare some params in the [CLI config file](https://github.com/jhuckaby/s3-api/blob/main/README.md#config-file), so you don't have to specify them for each CLI call.  When params are specified in both places, they are merged together, and the properties in the CLI call take precedence over those defined in the config file.

For a complete list of all the properties you can specify in `--params`, see the [AWS - PutObjectRequest](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/Interface/PutObjectRequest/) docs.

#### S3 Metadata

You can also use `--params` to store arbitrary S3 "metadata" (flat key/value pairs) that are stored alongside the S3 record.  The values are always stored as strings.  Example:

```sh
s3 upload /path/to/image.gif s3://my-bucket/s3dir/myfile.gif --params.Metadata.animal "frog"
```

To fetch metadata for a record, use the [head](#head) command, or for text/JSON records you can use [get](#get) with `--verbose` and `--pretty`.

### Compression

To control the gzip compression level when using upload commands and compression (namely [uploadFile](#uploadfile) and [uploadFiles](#uploadfiles)), use the `--gzip` argument.  You can set the compression level and memory usage level like this:

```sh
s3 upload /path/to/file.txt s3://my-bucket/s3dir/file.txt.gz --compress --gzip.level 9 --gzip.memLevel 9
```

See the [Node Zlib Class Options](https://nodejs.org/api/zlib.html#zlib_class_options) docs for more on these settings.

For controlling the compression level when using [snapshot](#snapshot) and [backup](#backup), the process is a bit different, as those commands shell out to tools like `tar` and `zip`.  When creating `.zip` snapshots or backups, use the `--zipArgs` argument.  This is passed directly to the `zip` utility:

```sh
s3 snapshot s3://my-bucket/s3dir/images /path/to/backup-[yyyy]-[mm]-[dd].zip --zipArgs " -r -9"
```

And when creating `.tar`, `.tar.gz`, `.tar.xz` or `.tar.bz2` snapshots or backups, use the `--tarArgs` argument.  This is passed directly to the `tar` utility:

```sh
s3 snapshot s3://my-bucket/s3dir/images /path/to/backup-[yyyy]-[mm]-[dd].tar.gz --tarArgs " -I 'gzip -9' -cvf"
```

For more details, see the [snapshot](#snapshot) and [backup](#backup) commands.

## Commands

### help

```
s3 help [COMMAND]
```

The `help` command prints a quick summary of all commands and their basic usage, or details for a specific command.  Example:

```sh
s3 help put
```

### docs

```
s3 docs
```

The `docs` command prints the contents of the CLI reference, with markdown conversion to formatted text.

### put

```
s3 put S3_URL RAW_JSON
s3 put S3_URL --value.KEY "VALUE" [--value.KEY "VALUE" ...]
```

The `put` command stores an object as a JSON-serialized record in S3, treating it like a key/value store.  You can specify the entire JSON document as a raw string, or by constructing it using dot.path.notation.  Here are examples of both methods:

```sh
s3 put s3://my-bucket/users/kermit.json '{"animal:"frog", "color":"green"}'
s3 put s3://my-bucket/users/kermit.json --value.animal "frog" --value.color "green"
```

The `put` command accepts the following named arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `value` | Object | The object value to store.  This will be serialized to JSON behind the scenes.  You can alternatively provide the full JSON document as a string. |
| `pretty` | Boolean | Optionally serialize the JSON using "pretty-printing" (formatting with multiple lines and tab indentations). |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |

Here is an example of enabling pretty-print and specifying an [S3 storage class](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html):

```sh
s3 put s3://my-bucket/users/kermit.json '{"animal:"frog", "color":"green"}' --pretty --params.StorageClass STANDARD_IA
```

### update

```
s3 update S3_URL --update.KEY "VALUE" [--update.KEY "VALUE" ...]
```

The `update` command updates a JSON-serialized record in S3, by selectively setting values using dot.path.notation.  You can add, replace or delete individual JSON properties in this way.  This will first [get](#get) the record, apply the updates, then [put](#put) it back to S3.  Example:

```sh
s3 update s3://my-bucket/users/kermit.json --update.animal "toad" --update.color _DELETE_ --update.newkey "newvalue"
```

The `update` command accepts the following arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `update` | Object | **(Required)** An object containing JSON paths and values to update.  Specify each property in dot.path.notation (see below for details). |
| `pretty` | Boolean | Optionally serialize the JSON using "pretty-printing" (formatting with multiple lines and tab indentations). |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [Custom S3 Params](https://github.com/jhuckaby/s3-api/blob/main/README.md#custom-s3-params). |

As you can see in the above example, you can replace properties (e.g. `animal`), delete properties (e.g. `color` -- set the value to `_DELETE_` to delete it), and add new ones (e.g. `newkey`).  You can also do this to sub-properties nested inside of objects, and even create new objects during the update.  To do this, use dot.path.notation for the update keys.  To illustrate, consider a pre-existing JSON record with this content:

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

Now, let's see what we can do with a call to `update`:

```sh
s3 update s3://my-bucket/users/fsmith.json --update.email "fsmith@email.com" --update.privileges.deleteRecords true --update.privileges.calendar true
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

It should be noted that data types are inferred when specified on the command-line like this.  Values that appear to be numbers are converted to JSON numbers, and `true` and `false` are converted to booleans.

### get

```
s3 get S3_URL [--KEY VALUE...]
```

The `get` command fetches an object that was written in JSON format (e.g. from [put](#put), or it can just be a JSON file that was uploaded to S3), and parses the JSON for you.  It is then printed to the console.  Example:

```sh
s3 get s3://my-bucket/users/kermit.json
```

The `get` command accepts the following named arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `subpath` | String | Optionally fetch a subpath (nested object) using dot.path.notation, instead of the entire JSON record. |
| `pretty` | Boolean | Optionally serialize the JSON using "pretty-printing" (formatting with multiple lines and tab indentations). |
| `quiet` | Boolean | Suppress all console output, except for the JSON record itself. |
| `verbose` | Boolean | Enable extra verbose output, for informational or troubleshooting purposes. |

### getStream

```
s3 getStream S3_URL [--KEY VALUE...]
```

The `getStream` command streams an S3 object to STDOUT, in any format, so you can pipe it to a file or another command, or for text files send it straight to the console.  Example:

```sh
s3 getStream s3://my-bucket/s3dir/myfile.gif > /path/to/myfile.gif
```

The `getStream` command accepts the following named arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `decompress` | Boolean | Automatically decompress file using gunzip during download. |
| `quiet` | Boolean | Suppress all console output, except for the raw record content itself. |
| `verbose` | Boolean | Enable extra verbose output, for informational or troubleshooting purposes. |

### putStream

```
s3 putStream S3_URL [--KEY VALUE...]
```

The `putStream` command reads from STDIN and streams that content up to an S3 record.  The data can be in any format.  Example:

```sh
cat /path/to/myfile.gif | s3 putStream s3://my-bucket/s3dir/myfile.gif
```

The `putStream` command accepts the following named arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `params` | Object | Optionally pass custom parameters directly to the AWS API.  See [S3 Params](#s3-params). |
| `compress` | Boolean | Optionally compress the file as it is being uploaded using gzip. |
| `gzip` | Object | Control the gzip compression settings.  See [Compression](#compression). |

### head

```
s3 head S3_URL
```

The `head` command pings an object to check for its existence, and returns basic information about it.  Example:

```sh
s3 head s3://my-bucket/s3dir/myfile.gif
```

A typical response looks like this:

```json
{
	"meta": {
		"$metadata": {
			"httpStatusCode": 200,
			"requestId": "12345",
			"extendedRequestId": "12345ABCDEF",
			"attempts": 1,
			"totalRetryDelay": 0
		},
		"AcceptRanges": "bytes",
		"LastModified": "2024-05-26T00:28:57.000Z",
		"ContentLength": 72813,
		"ETag": "\"71a8f5b489106e0a6ad667368ae5d514\"",
		"ContentType": "image/gif",
		"ServerSideEncryption": "AES256",
		"Metadata": {},
		"size": 72813,
		"mtime": 1716683337
	}
}
```

### list

```
s3 list S3_URL [--KEY VALUE...]
s3 ls S3_URL [--KEY VALUE...]
```

The `list` command (alias `ls`) fetches and outputs a listing of remote S3 objects that exist under a specified key prefix, and optionally match a specified filter.  It will automatically loop and paginate as required, returning the full set of matched objects regardless of count.  Example:

```sh
s3 list s3://my-bucket/s3dir/
```

The `list` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `filespec` | RegExp | Optionally filter the filenames using a regular expression (matched only on the filenames). |
| `include` | RegExp | Optionally restrict files using an inclusion regular expression pattern (matched on the whole file paths). |
| `exclude` | RegExp | Optionally exclude files using an exclusion regular expression pattern (matched on the whole file paths). |
| `newer` | Mixed | Optionally filter files to those modified after a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `older` | Mixed | Optionally filter files to those modified before a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `larger` | Mixed | Optionally filter files to those larger than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `smaller` | Mixed | Optionally filter files to those smaller than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `json` | Boolean | Optionally return the results in JSON format, rather than an ASCII table.  Combine with `--quiet` for pure JSON output. |
| `csv` | Boolean | Optionally return the results in CSV format, rather than an ASCII table.  Combine with `--quiet` for pure CSV output. |

**Notes:**

- Make sure to include a trailing slash if you intend to look inside an S3 "directory".  The URL is interpreted as a "S3 key prefix" so it can match partial filenames unless delimited.
- When specifying a `--filespec`, `--include` or `--exclude`, single-quotes are recommended.  This makes it easier to type regular expressions, as you don't need to escape backslashes, e.g. `--filespec '\.gif$'`.

### listFolders

```
s3 listFolders S3_URL [--KEY VALUE...]
s3 lf S3_URL [--KEY VALUE...]
```

The `listFolders` command (alias `lf`) fetches and outputs a listing of remote S3 files and "subfolders" that exist under a specified key prefix.  The S3 storage system doesn't *really* have a folder tree, but it fakes one by indexing keys by a delimiter (typically slash).  This method fetches one subfolder level only -- it does not recurse for nested folders.  Example:

```sh
s3 listFolders s3://my-bucket/s3dir/
```

The `listFolders` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `delimiter` | String | Optionally change the folder delimiter.  It defaults to a forward-slash (`/`). |
| `json` | Boolean | Optionally return the results in JSON format, rather than an ASCII table.  Combine with `--quiet` for pure JSON output. |
| `csv` | Boolean | Optionally return the results in CSV format, rather than an ASCII table.  Combine with `--quiet` for pure CSV output. |

**Notes:**

- Always include a trailing slash when specifying directories.

### listBuckets

```
s3 listBuckets [--KEY VALUE...]
s3 lb [--KEY VALUE...]
```

The `listBuckets` command (alias `lb`) fetches the complete list of S3 buckets in your AWS account.  It accepts no options.  Example:

```sh
s3 listBuckets
```

The `listBuckets` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `json` | Boolean | Optionally return the results in JSON format, rather than an ASCII table.  Combine with `--quiet` for pure JSON output. |
| `csv` | Boolean | Optionally return the results in CSV format, rather than an ASCII table.  Combine with `--quiet` for pure CSV output. |

### grep

```
s3 grep REGEX S3_URL/ [--KEY VALUE...]
```

The `grep` command recursively searches inside S3 files starting at a specified base path, matching a provided regular expression on each line.  Matched lines are printed to the console along with the S3 file path.  You can also provide additional filters for only looking inside some files, based on their file patterns, size or modification dates.  Example:

```sh
s3 grep 'Incoming Request' s3://my-bucket/s3dir/logfiles/ --filespec '\.log\.gz$' --decompress
```

The `grep` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `filespec` | RegExp | Optionally filter the S3 filenames using a regular expression (matched only on the filenames). |
| `include` | RegExp | Optionally restrict files using an inclusion regular expression pattern (matched on the whole file paths). |
| `exclude` | RegExp | Optionally exclude files using an exclusion regular expression pattern (matched on the whole file paths). |
| `newer` | Mixed | Optionally filter files to those modified after a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `older` | Mixed | Optionally filter files to those modified before a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `larger` | Mixed | Optionally filter files to those larger than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `smaller` | Mixed | Optionally filter files to those smaller than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `decompress` | Boolean | Automatically decompress all files using gunzip during download.  Disabled by default. |
| `match` | RegExp | Optionally filter lines to only those matching the provided regular expression. |
| `max` | Number | Optionally limit the number of matched lines to the specified value. |
| `threads` | Integer | Optionally increase concurrency to improve performance.  Defaults to `1` thread. |
| `quiet` | Boolean | Include this argument to suppress all output except the matched lines. |

**Notes:**

- Always include a trailing slash when specifying directories.
- For the regular expression, single-quotes are recommended so you don't need to escape backslashes.
- Files are streamed and [line-read](https://nodejs.org/api/readline.html#readline), so very little memory will be used, even for huge files, and even for compressed files.

### copy

```
s3 copy S3_URL_OR_LOCAL_PATH S3_URL_OR_LOCAL_PATH
s3 cp S3_URL_OR_LOCAL_PATH S3_URL_OR_LOCAL_PATH
```

The `copy` command (alias `cp`) is an omni-command -- a multi-command hub, which will route to other commads automatically, performing the correct action given the arguments and flags passed in.  It can copy objects from S3 to S3, download files or folders from S3, or upload files or folders to S3.  You can pass any combination of S3 URL and S3 URL, S3 URL and local path, or local path and S3 URL.  S3 URLs are recognized by the prefix, which can be `s3://`, `s3:` or even `//` (protocol-relative).  If the argument doesn't match one of those patterns, it is assumed ot be a local filesystem path.  Here is how it works:

If you specify two S3 URLs, one is copied to the other (this routes the command to [copyFile](#copyfile)).  Add `--recursive` (or `-r`) and it routes to [copyFiles](#copyfiles).  Examples:

```sh
# Copy file from S3 to S3
s3 copy s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json

# Copy entire folder from S3 to S3
s3 copy s3://my-bucket/users/ s3://my-bucket/newusers/ --recursive
```

If you specify one S3 URL and a local path, it downloads the S3 file to local disk (this routes the command to [dowloadFile](#downloadfile)).  Add `--recursive` (or `-r`) and it routes to [downloadFiles](#downloadfiles).  Examples:

```sh
# Download file from S3 to local disk
s3 copy s3://my-bucket/s3dir/myfile.gif /path/to/image.gif

# Download folder from S3 to local disk
s3 copy s3://my-bucket/s3dir/uploaded/ /path/to/images/ --recursive
```

And if you specify a local path followed by a S3 URL, it uploads the file to S3 (this routes the command to [uploadFile](#uploadfile)).  Add `--recursive` (or `-r`) and it routes to [uploadFiles](#uploadfiles).  Examples:

```sh
# Upload file from disk to S3
s3 copy /path/to/image.gif s3://my-bucket/s3dir/myfile.gif

# Upload folder from disk to S3
s3 copy /path/to/images/ s3://my-bucket/s3dir/uploaded/ --recursive
```

Of course, you can use the specific [copyFile](#copyfile), [copyFiles](#copyfiles), [dowloadFile](#downloadfile), [downloadFiles](#downloadfiles), [uploadFile](#uploadfile) or [uploadFiles](#uploadfiles) commands, but it's easier to just remember `copy` (or alias `cp`), which does them all.

### copyFile

```
s3 copyFile S3_SRC_URL S3_DEST_URL [--KEY VALUE...]
```

The `copyFile` command copies one S3 object to another S3 location.  This can copy between buckets as well.  Example:

```sh
s3 copyFile s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json
```

The `copyFile` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `recursive` (`r`) | Boolean | Switch to recursive mode, i.e. call [copyFiles](#copyfiles) instead. |
| `params` | Object | Optionally pass custom parameters directly to the AWS API for the destination file.  See [S3 Params](#s3-params). |

**Notes:** 

- The AWS SDK does not preserve metadata, such as ACL and storage class, when copying objects.

### copyFiles

```
s3 copyFiles S3_SRC_URL/ S3_DEST_URL/ [--KEY VALUE...]
```

The `copyFiles` command recursively copies multiple files / directories from S3 to another S3 location.  Example:

```sh
s3 copyFiles s3://my-bucket/users/ s3://my-bucket/newusers/
```

The `copyFiles` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `filespec` | RegExp | Optionally filter the source S3 filenames using a regular expression (matched only on the filenames). |
| `include` | RegExp | Optionally restrict files using an inclusion regular expression pattern (matched on the whole file paths). |
| `exclude` | RegExp | Optionally exclude files using an exclusion regular expression pattern (matched on the whole file paths). |
| `newer` | Mixed | Optionally filter files to those modified after a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `older` | Mixed | Optionally filter files to those modified before a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `larger` | Mixed | Optionally filter files to those larger than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `smaller` | Mixed | Optionally filter files to those smaller than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `threads` | Integer | Optionally increase concurrency to improve performance.  Defaults to `1` thread. |
| `params` | Object | Optionally pass custom parameters directly to the AWS API for the destination files.  See [S3 Params](#s3-params). |

**Notes:**

- Always include a trailing slash when specifying directories.
- The AWS SDK does not preserve metadata, such as ACL and storage class, when copying objects.

### move

```
s3 move S3_URL_OR_LOCAL_PATH S3_URL_OR_LOCAL_PATH
s3 mv S3_URL_OR_LOCAL_PATH S3_URL_OR_LOCAL_PATH
```

The `move` command (alias `mv`) is an omni-command -- a multi-command hub, which will route to other commads automatically, performing the correct action given the arguments and flags passed in.  It can move objects from S3 to S3, download files or folders from S3 (deleting the originals), or upload files or folders to S3 (deleting the originals).  You can pass any combination of S3 URL and S3 URL, S3 URL and local path, or local path and S3 URL.  S3 URLs are recognized by the prefix, which can be `s3://`, `s3:` or even `//` (protocol-relative).  If the argument doesn't match one of those patterns, it is assumed ot be a local filesystem path.  Here is how it works:

If you specify two S3 URLs, one is moved to the other (this routes the command to [moveFile](#movefile)).  Add `--recursive` (or `-r`) and it routes to [moveFiles](#movefiles).  Examples:

```sh
# Move file from S3 to S3
s3 move s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json

# Move entire folder from S3 to S3
s3 move s3://my-bucket/users/ s3://my-bucket/newusers/ --recursive
```

If you specify one S3 URL and a local path, it downloads the S3 file to local disk and deletes the original (this routes the command to [dowloadFile](#downloadfile) with the `--delete` flag).  Add `--recursive` (or `-r`) and it routes to [downloadFiles](#downloadfiles) with `--delete`.  Examples:

```sh
# Download file from S3 to local disk, delete original
s3 move s3://my-bucket/s3dir/myfile.gif /path/to/image.gif

# Download folder from S3 to local disk, delete original
s3 move s3://my-bucket/s3dir/uploaded/ /path/to/images/ --recursive
```

And if you specify a local path followed by a S3 URL, it uploads the file to S3 and deletes the original (this routes the command to [uploadFile](#uploadfile) with the `--delete` flag).  Add `--recursive` (or `-r`) and it routes to [uploadFiles](#uploadfiles) with `--delete`.  Examples:

```sh
# Upload file from disk to S3, delete original
s3 move /path/to/image.gif s3://my-bucket/s3dir/myfile.gif

# Upload folder from disk to S3, delete original
s3 move /path/to/images/ s3://my-bucket/s3dir/uploaded/ --recursive
```

Of course, you can use the specific [moveFile](#movefile), [moveFiles](#movefiles), [dowloadFile](#downloadfile) with `--delete`, [downloadFiles](#downloadfiles) with `--delete`, [uploadFile](#uploadfile) with `--delete`, or [uploadFiles](#uploadfiles) with `--delete`, but it's easier to just remember `move` (or alias `mv`), which does them all.

### moveFile

```
s3 moveFile S3_SRC_URL S3_DEST_URL [--KEY VALUE...]
```

The `moveFile` command moves one S3 object to another S3 location.  Essentially, it performs a [copyFile](#copyfile) followed by a [deleteFile](#deletefile).  This can move between buckets as well.  Example:

```sh
s3 moveFile s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json
```

The `moveFile` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `recursive` (`r`) | Boolean | Switch to recursive mode, i.e. call [moveFiles](#movefiles) instead. |
| `params` | Object | Optionally pass custom parameters directly to the AWS API for the destination file.  See [S3 Params](#s3-params). |

**Notes:**

- The AWS SDK does not preserve metadata, such as ACL and storage class, when moving objects.

### moveFiles

```
s3 moveFiles S3_SRC_URL/ S3_DEST_URL/ [--KEY VALUE...]
```

The `moveFiles` command recursively moves multiple files / directories from S3 to another S3 location.  Essentially, it performs a [copyFile](#copyfile) followed by a [deleteFile](#deletefile) on each file.  Example:

```sh
s3 moveFiles s3://my-bucket/users/ s3://my-bucket/newusers/
```

The `moveFiles` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `filespec` | RegExp | Optionally filter the source S3 filenames using a regular expression (matched only on the filenames). |
| `include` | RegExp | Optionally restrict files using an inclusion regular expression pattern (matched on the whole file paths). |
| `exclude` | RegExp | Optionally exclude files using an exclusion regular expression pattern (matched on the whole file paths). |
| `newer` | Mixed | Optionally filter files to those modified after a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `older` | Mixed | Optionally filter files to those modified before a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `larger` | Mixed | Optionally filter files to those larger than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `smaller` | Mixed | Optionally filter files to those smaller than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `threads` | Integer | Optionally increase concurrency to improve performance.  Defaults to `1` thread. |
| `params` | Object | Optionally pass custom parameters directly to the AWS API for the destination files.  See [S3 Params](#s3-params). |

**Notes:**

- Always include a trailing slash when specifying directories.
- The AWS SDK does not preserve metadata, such as ACL and storage class, when moving objects.

### deleteFile

```
s3 deleteFile S3_URL [--KEY VALUE...]
s3 delete S3_URL [--KEY VALUE...]
s3 rm S3_URL [--KEY VALUE...]
```

The `deleteFile` command (alias `delete` or `rm`) deletes a single object from S3 given its key.  Please use caution here, as there is no way to undo a delete (unless you use versioned buckets I suppose).  Example:

```sh
s3 deleteFile s3://my-bucket/s3dir/myfile.gif
```

The `deleteFile` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `recursive` (`r`) | Boolean | Switch to recursive mode, i.e. call [deleteFiles](#deletefiles) instead. |

### deleteFiles

```
s3 deleteFiles S3_URL/ [--KEY VALUE...]
```

The `deleteFiles` command recursively deletes multiple files / directories from S3.  Please use extreme caution here, as there is no way to undo deletes (unless you use versioned buckets I suppose).  Example:

```sh
s3 deleteFiles s3://my-bucket/s3dir/uploaded/
```

The `deleteFiles` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `filespec` | RegExp | Optionally filter the S3 filenames using a regular expression (matched only on the filenames). |
| `include` | RegExp | Optionally restrict files using an inclusion regular expression pattern (matched on the whole file paths). |
| `exclude` | RegExp | Optionally exclude files using an exclusion regular expression pattern (matched on the whole file paths). |
| `newer` | Mixed | Optionally filter files to those modified after a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `older` | Mixed | Optionally filter files to those modified before a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `larger` | Mixed | Optionally filter files to those larger than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `smaller` | Mixed | Optionally filter files to those smaller than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `threads` | Integer | Optionally increase concurrency to improve performance.  Defaults to `1` thread. |

**Notes:**

- Always include a trailing slash when specifying directories.

### uploadFile

```
s3 uploadFile LOCAL_FILE S3_URL [--KEY VALUE...]
s3 upload LOCAL_FILE S3_URL [--KEY VALUE...]
s3 up LOCAL_FILE S3_URL [--KEY VALUE...]
```

The `uploadFile` command (alias `upload` or `up`) uploads a single file from the local filesystem to an object in S3.  This uses streams and multi-part chunks internally, so it can handle files of any size while using very little memory.  Example:

```sh
s3 uploadFile /path/to/image.gif s3://my-bucket/s3dir/myfile.gif
```

Note that you can omit the filename portion of the S3 URL if you want.  Specifically, if the S3 URL ends with a slash (`/`) the library will automatically append the local filename to the end of the S3 key.

The `uploadFile` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `recursive` (`r`) | Boolean | Switch to recursive mode, i.e. call [uploadFiles](#uploadfiles) instead. |
| `params` | Object | Optionally pass custom parameters directly to the AWS API.  See [S3 Params](#s3-params). |
| `compress` | Boolean | Optionally compress the file as it is being uploaded using gzip. |
| `gzip` | Object | Control the gzip compression settings.  See [Compression](#compression). |
| `delete` | Boolean | Optionally delete the source file after upload is complete. |

### uploadFiles

```
s3 uploadFiles LOCAL_DIR/ S3_URL/ [--KEY VALUE...]
```

The `uploadFiles` command recursively uploads multiple files / directories from the local filesystem to S3.  This uses streams and multi-part uploads internally, so it can handle files of any size while using very little memory.  Example:

```sh
s3 uploadFiles /path/to/images/ s3://my-bucket/s3dir/uploaded/
```

The `uploadFiles` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `filespec` | RegExp | Optionally filter the local filenames using a regular expression (matched only on the filenames). |
| `include` | RegExp | Optionally restrict files using an inclusion regular expression pattern (matched on the whole file paths). |
| `exclude` | RegExp | Optionally exclude files using an exclusion regular expression pattern (matched on the whole file paths). |
| `newer` | Mixed | Optionally filter files to those modified after a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `older` | Mixed | Optionally filter files to those modified before a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `larger` | Mixed | Optionally filter files to those larger than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `smaller` | Mixed | Optionally filter files to those smaller than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `all` | Boolean | Optionally include dotfiles (filenames that begin with a period) in the upload (the default is to skip them). |
| `threads` | Integer | Optionally increase concurrency to improve performance.  Defaults to `1` thread. |
| `compress` | Boolean | Automatically compress all files using gzip during upload.  Disabled by default. |
| `gzip` | Object | Control the gzip compression settings.  See [Compression](#compression). |
| `suffix` | String | Optionally append a suffix to every destination S3 key, e.g. `.gz` for compressed files. |
| `delete` | Boolean | Optionally delete the source files after upload is complete. |
| `params` | Object | Optionally specify parameters to the S3 API, for e.g. ACL and Storage Class.  See [S3 Params](#s3-params). |

**Notes:**

- Always include a trailing slash when specifying directories.

### downloadFile

```
s3 downloadFile S3_URL LOCAL_FILE [--KEY VALUE...]
s3 download S3_URL LOCAL_FILE [--KEY VALUE...]
s3 dl S3_URL LOCAL_FILE [--KEY VALUE...]
```

The `downloadFile` command (alias `download` or `dl`) downloads a single object from S3, and saves it to a local file on disk.  The local file's parent directories will be automatically created if needed.  This uses streams internally, so it can handle files of any size while using very little memory.  Example:

```sh
s3 downloadFile s3://my-bucket/s3dir/myfile.gif /path/to/image.gif
```

Note that you can omit the filename portion of the local file path if you want.  Specifically, if the local path ends with a slash (`/`) the library will automatically append the filename from the S3 key.

The `downloadFile` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `recursive` (`r`) | Boolean | Switch to recursive mode, i.e. call [downloadFiles](#downloadfiles) instead. |
| `decompress` | Boolean | Automatically decompress file using gunzip during download. |
| `delete` | Boolean | Optionally delete the S3 file after download is complete. |

### downloadFiles

```
s3 downloadFiles S3_URL/ LOCAL_DIR/ [--KEY VALUE...]
```

The `downloadFiles` command recursively downloads multiple files / directories from S3 to the local filesystem.  Local parent directories will be automatically created if needed.  This uses streams internally, so it can handle files of any size while using very little memory.  Example:

```sh
s3 downloadFiles s3://my-bucket/s3dir/uploaded/ /path/to/images/
```

The `downloadFiles` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `filespec` | RegExp | Optionally filter the S3 filenames using a regular expression (matched only on the filenames). |
| `include` | RegExp | Optionally restrict files using an inclusion regular expression pattern (matched on the whole file paths). |
| `exclude` | RegExp | Optionally exclude files using an exclusion regular expression pattern (matched on the whole file paths). |
| `newer` | Mixed | Optionally filter files to those modified after a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `older` | Mixed | Optionally filter files to those modified before a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `larger` | Mixed | Optionally filter files to those larger than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `smaller` | Mixed | Optionally filter files to those smaller than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `threads` | Integer | Optionally increase concurrency to improve performance.  Defaults to `1` thread. |
| `decompress` | Boolean | Automatically decompress all files using gunzip during download.  Disabled by default. |
| `strip` | RegExp | Optionally strip a suffix from every destination filename, e.g. `\.gz$` to strip the `.gz` suffix off of compressed files. |
| `delete` | Boolean | Optionally delete the S3 files after download is complete. |

**Notes:**

- Always include a trailing slash when specifying directories.

### snapshot

```
s3 snapshot S3_URL/ LOCAL_FILE [--KEY VALUE...]
s3 snap S3_URL/ LOCAL_FILE [--KEY VALUE...]
```

The `snapshot` command (alias `snap`) takes a "snapshot" of an S3 location, including all nested files and directories, and produces a local `.zip`, `.tar`, `.tar.gz`, `.tar.xz` or `.tar.bz2` archive file.  This snapshot file can then be restored back to S3 using the [restoreSnapshot](#restoresnapshot) command.  Example use:

```sh
s3 snapshot s3://my-bucket/s3dir/images/ /path/to/snapshot-[yyyy]-[mm]-[dd].zip
```

You can use date/time placeholders in the destination filename, to embed a custom timestamp.  The placeholder format is `[yyyy]`, `[mm]`, `[dd]`, etc.  See [getDateArgs()](https://github.com/jhuckaby/pixl-tools?tab=readme-ov-file#getdateargs) for a list of all possible macros you can specify here.

The `snapshot` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `filespec` | RegExp | Optionally filter the snapshot filenames using a regular expression (matched only on the filenames). |
| `include` | RegExp | Optionally restrict files using an inclusion regular expression pattern (matched on the whole file paths). |
| `exclude` | RegExp | Optionally exclude files using an exclusion regular expression pattern (matched on the whole file paths). |
| `newer` | Mixed | Optionally filter files to those modified after a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `older` | Mixed | Optionally filter files to those modified before a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `larger` | Mixed | Optionally filter files to those larger than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `smaller` | Mixed | Optionally filter files to those smaller than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `threads` | Integer | Optionally increase concurrency to improve performance.  Defaults to `1` thread. |
| `expire` | String | Optionally expire (delete) the local snapshots after a specified interval, e.g. "30 days".  *Please see note below.* |
| `zipArgs` | String | If your snapshot archive is a `.zip` file, you can customize the arguments to the `zip` binary, e.g. `" -r -9"` for max compression. |
| `tarArgs` | String | If your snapshot archive is a `.tar`, `.tar.gz`, `.tar.xz` or `.tar.bz2` file, you can customize the arguments to the `tar` binary, e.g. `" -I 'gzip -9' -cvf"` for max gzip compression. |
| `tempDir` | String | Optionally customize the temp directory used internally. |

**Notes:**

- Always include a trailing slash when specifying directories.
- The `--expire` option assumes that your snapshots live in their own directory.  It will expire **all files** it finds in the directory that are older than N days.  Please use with extreme caution.
- If you use `--zipArgs` or `--tarArgs`, make sure you insert a leading space in the value, inside quotes, e.g. `--zipArgs " -r -9"` or `--tarArgs " -I 'gzip -9' -cvf"`.  This insures that the sub-argument will be parsed properly.

### restoreSnapshot

```
s3 restoreSnapshot LOCAL_FILE S3_URL/ [--KEY VALUE...]
s3 rs LOCAL_FILE S3_URL/ [--KEY VALUE...]
```

The `restoreSnapshot` command (alias `rs`) restores a previously created snapshot back to S3, using a local archive file as a source.  The archive should have been previously created via the [snapshot](#snapshot) command.  Example use:

```sh
s3 restoreSnapshot /path/to/snapshot-2024-05-22.zip s3://my-bucket/s3dir/images/
```

The `restoreSnapshot` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `filespec` | RegExp | Optionally filter the snapshot filenames using a regular expression (matched only on the filenames). |
| `include` | RegExp | Optionally restrict files using an inclusion regular expression pattern (matched on the whole file paths). |
| `exclude` | RegExp | Optionally exclude files using an exclusion regular expression pattern (matched on the whole file paths). |
| `newer` | Mixed | Optionally filter files to those modified after a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `older` | Mixed | Optionally filter files to those modified before a specified date, or delta time.  Dates should be parsable by JavaScript, delta times can be "7 days", etc. |
| `larger` | Mixed | Optionally filter files to those larger than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `smaller` | Mixed | Optionally filter files to those smaller than a specified size, which can be raw bytes, or a string such as "50K", "500MB", "32GB", "1TB", etc. |
| `threads` | Integer | Optionally increase concurrency to improve performance.  Defaults to `1` thread. |
| `delete` | Boolean | Optionally **delete** the entire S3 location before restoring.  **Use with caution**.  This does honor the filtering criteria. |
| `tempDir` | String | Optionally customize the temp directory used internally. |

**Notes:**

- Always include a trailing slash when specifying directories.
- As of this writing, the S3 API cannot set modification dates upon upload, so restoring a snapshot "resets" all the S3 record modification dates to the current date/time.  Also, snapshots do not (currently) preserve metadata or other params on the files.

### backup

```
s3 backup LOCAL_DIR/ S3_URL [--KEY VALUE...]
s3 bk LOCAL_DIR/ S3_URL [--KEY VALUE...]
```

The `backup` command (alias `bk`) makes a backup of a local filesystem directory, and uploads an archive to S3 for safekeeping.  The archive file can be in `.zip`, `.tar`, `.tar.gz`, `.tar.xz` or `.tar.bz2` format.  Example:

```sh
s3 backup /path/to/files/ s3://my-bucket/backups/mybackup-[yyyy]-[mm]-[dd].zip
```

You can use date/time placeholders in the destination S3 URL, to embed a custom timestamp.  The placeholder format is `[yyyy]`, `[mm]`, `[dd]`, etc.  See [getDateArgs()](https://github.com/jhuckaby/pixl-tools?tab=readme-ov-file#getdateargs) for a list of all possible macros you can specify here.

The `backup` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `expire` | String | Optionally expire (delete) the S3 archives after a specified interval, e.g. "30 days".  *Please see note below.* |
| `zipArgs` | String | If your backup is a `.zip` file, you can customize the arguments to the `zip` binary, e.g. `" -r -9"` for max compression. |
| `tarArgs` | String | If your backup is a `.tar`, `.tar.gz`, `.tar.xz` or `.tar.bz2` file, you can customize the arguments to the `tar` binary, e.g. `" -I 'gzip -9' -cvf"` for max gzip compression. |
| `tempDir` | String | Optionally customize the temp directory used internally. |

**Notes:**

- Always include a trailing slash when specifying directories.
- The `--expire` option assumes that your backups live in their own S3 directory.  It will expire **all files** it finds in the S3 directory that are older than N days.  Please use with extreme caution.
- If you use `--zipArgs` or `--tarArgs`, make sure you insert a leading space in the value, inside quotes, e.g. `--zipArgs " -r -9"` or `--tarArgs " -I 'gzip -9' -cvf"`.  This insures that the sub-argument will be parsed properly.

### restoreBackup

```
s3 restoreBackup S3_URL LOCAL_DIR/ [--KEY VALUE...]
s3 rb S3_URL LOCAL_DIR/ [--KEY VALUE...]
```

The `restoreBackup` command (alias `rb`) restores a backup previously created via the [backup](#backup) command.  This downloads the backup archive from S3 and expands it back onto the filesystem.  Example use:

```sh
s3 restoreBackup s3://my-bucket/backups/mybackup-2024-05-22.zip /path/to/files/
```

The `restoreBackup` command accepts the following optional arguments:

| Property Name | Type | Description |
|---------------|------|-------------|
| `delete` | Boolean | Optionally **delete** the entire local directory before restoring.  **Use with caution**. |
| `tempDir` | String | Optionally customize the temp directory used internally. |

**Notes:**

- Always include a trailing slash when specifying directories.
