#!/usr/bin/env node

// S3 CLI
// See: https://github.com/jhuckaby/s3-api
// Copyright (c) 2024 Joseph Huckaby, MIT License

const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const Path = require('path');
const cli = require('pixl-cli');
const Tools = require('pixl-tools');
const pkg = require('./package.json');

cli.global();

// optional config file for args defaults
var config_file = Path.join( process.env.HOME, '.s3-config.json' );
if (fs.existsSync(config_file)) Tools.mergeHashInto(cli.args, JSON.parse( fs.readFileSync(config_file, 'utf8') ));

// optional log file
if (cli.args.log) {
	cli.setLogFile( cli.args.log );
	delete cli.args.log;
}

// optional custom temp dir
const TEMP_DIR = cli.args.tempDir || os.tmpdir();
delete cli.args.tempDir;

// coerce true/false into booleans
for (var key in cli.args) {
	if (cli.args[key] === 'true') cli.args[key] = true;
	else if (cli.args[key] === 'false') cli.args[key] = false;
}

// allow args to be dot.path.syntax
var args = {};
for (var key in cli.args) {
	Tools.setPath( args, key, cli.args[key] );
}

if (!args.other || !args.other.length || args.help || args.h) args.other = ['help'];
var cmd = args.other.shift();

const S3 = require('.');

var CMD_HELP_TEXT = {
	docs: `s3 docs`,
	
	// put: `s3 put --bucket my-bucket --key users/kermit.json --value.animal "frog" --value.color "green"`,
	put: `s3 put s3://my-bucket/users/kermit.json '{"animal":"frog", "color":"green"}'`,
	
	// putStream: `s3 putStream --bucket my-bucket --key s3dir/myfile.gif`
	putStream: `s3 putStream s3://my-bucket/s3dir/myfile.gif`,
	
	// update: `s3 update --bucket my-bucket --key users/kermit.json --update.animal "frog" --update.color "green"`,
	update: `s3 update s3://my-bucket/users/kermit.json --update.animal "frog" --update.color "green"`,
	
	// get: `s3 get --bucket my-bucket --key users/kermit.json`,
	get: `s3 get s3://my-bucket/users/kermit.json`,
	
	// getStream: `s3 getStream --bucket my-bucket --key s3dir/myfile.gif`
	getStream: `s3 getStream s3://my-bucket/s3dir/myfile.gif`,
	
	// head: `s3 head --bucket my-bucket --key "s3dir/myfile.gif"`,
	head: `s3 head s3://my-bucket/s3dir/myfile.gif`,
	
	// list: `s3 list --bucket my-bucket --remotePath s3dir`,
	list: `s3 list s3://my-bucket/s3dir/`,
	
	// listFolders: `s3 listFolders --bucket my-bucket --remotePath "s3dir"`,
	listFolders: `s3 listFolders s3://my-bucket/s3dir/`,
	
	// listBuckets: `s3 listBuckets`,
	listBuckets: `s3 listBuckets`,
	
	// copy: `s3 copy --bucket my-bucket --sourceKey "users/oldkermit.json" --key "users/newkermit.json"`,
	copy: `s3 copy s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json`,
	
	// move: `s3 move --bucket my-bucket --sourceKey "users/oldkermit.json" --key "users/newkermit.json"`,
	move: `s3 move s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json`,
	
	// delete: `s3 delete --bucket my-bucket --key "s3dir/myfile.gif"`,
	delete: `s3 delete s3://my-bucket/s3dir/myfile.gif`,
	
	// uploadFile: `s3 uploadFile --bucket my-bucket --localFile "/path/to/image.gif" --key "s3dir/myfile.gif"`,
	upload: `s3 upload /path/to/image.gif s3://my-bucket/s3dir/myfile.gif`,
	
	// downloadFile: `s3 downloadFile --bucket my-bucket --key "s3dir/myfile.gif" --localFile "/path/to/image.gif"`,
	download: `s3 download s3://my-bucket/s3dir/myfile.gif /path/to/image.gif`,
	
	// uploadFiles: `s3 uploadFiles --bucket my-bucket --localPath "/path/to/images" --remotePath "s3dir/uploaded"`,
	uploadFiles: `s3 uploadFiles /path/to/images s3://my-bucket/s3dir/uploaded`,
	
	// downloadFiles: `s3 downloadFiles --bucket my-bucket --remotePath "s3dir/uploaded" --localPath "/path/to/images"`,
	downloadFiles: `s3 downloadFiles s3://my-bucket/s3dir/uploaded /path/to/images`,
	
	// deleteFiles: `s3 deleteFiles --bucket my-bucket --remotePath "s3dir/uploaded" --filespec '\\.gif$'`,
	deleteFiles: `s3 deleteFiles s3://my-bucket/s3dir/uploaded --filespec '\\.gif$'`,
	
	// snapshot: `s3 snapshot --bucket my-bucket --remotePath "s3dir/images" --localFile "/path/to/backup-[yyyy]-[mm]-[dd].zip"`,
	snapshot: `s3 snapshot s3://my-bucket/s3dir/images /path/to/snapshot-[yyyy]-[mm]-[dd].zip`,
	
	// restoreSnapshot: `s3 restoreSnapshot --bucket my-bucket --localFile "/path/to/backup-[yyyy]-[mm]-[dd].zip" --remotePath "s3dir/images"`,
	restoreSnapshot: `s3 restoreSnapshot /path/to/snapshot-2024-05-22.zip s3://my-bucket/s3dir/images`,
	
	// backup: `s3 backup --bucket my-bucket --localPath "/path/to/files" --key "backups/mybackup-[yyyy]-[mm]-[dd].zip"`,
	backup: `s3 backup /path/to/files s3://my-bucket/backups/mybackup-[yyyy]-[mm]-[dd].zip`,
	
	// restoreBackup: `s3 restoreBackup --bucket my-bucket --key "backups/mybackup-2024-05-22.zip" --localPath "/path/to/files"`
	restoreBackup: `s3 restoreBackup s3://my-bucket/backups/mybackup-2024-05-22.zip /path/to/files`
};

var app = {
	
	async run() {
		// main entry point
		var self = this;
		
		// copy some args over to S3 API
		var s3_args = {};
		for (var key in args) {
			if (key.match(/^(region|bucket|credentials|prefix|params|gzip|timeout|connectTimeout|retries)$/)) {
				s3_args[key] = args[key];
				delete args[key];
				delete cli.args[key];
			}
		}
		
		this.s3 = new S3(s3_args);
		this.version = pkg.version;
		
		// faux console logger
		this.logger = this.s3.logger = {
			debugLevel: 1,
			get: function(key) { return this[key]; },
			set: function(key, value) { this[key] = value; },
			
			debug: function(level, msg, data) {
				println( green(msg) );
				if (data) {
					// only include data column in verbose mode
					if (typeof(data) == 'object') verboseln( gray(JSON.stringify(data)) );
					else verboseln( gray( data.toString().trimRight() ) );
				}
			},
			error: function(code, msg, data) {
				println( red.bold('[ERROR]['+code+'] ') + yellow.bold(msg) );
				if (data) println( gray(JSON.stringify(data)) );
			}
		};
		
		if (args.verbose) this.logger.set('debugLevel', 9);
		
		// optionally disable all ANSI color
		if (("color" in args) && !args.color) {
			cli.chalk.enabled = false;
		}
		
		delete args.verbose;
		delete args.color;
		delete args.quiet;
		
		print("\n");
		println( "🪣 " + bold.magenta("S3 API ") + magenta("v" + this.version) );
		
		this.cmd = cmd;
		
		if (this['cmd_' + cmd]) {
			await this['cmd_' + cmd]();
		}
		else {
			// throw over to s3-api directly
			print("\n");
			
			try {
				var result = await this.s3[cmd](args);
				if (result && result.meta && result.meta.Body) delete result.meta.Body; // way too verbose
				println( "\n" + cli.jsonPretty(result || false) );
			}
			catch (err) {
				this.die(err);
			}
		}
		
		// always end with empty line
		print("\n");
	},
	
	die(msg, extra = "") {
		// colorful die
		if ((typeof(msg) == 'object') && msg.message) msg = msg.message;
		die( "\n❌ " + red.bold("ERROR: ") + yellow.bold(msg) + "\n\n" + extra );
	},
	
	usage(text) {
		if (CMD_HELP_TEXT[text]) text = CMD_HELP_TEXT[text];
		return yellow.bold("Usage: ") + green(text.trim()) + "\n\n";
	},
	
	dieUsage(text) {
		die( "\n" + this.usage(text) );
	},
	
	shiftS3Spec(bucket_name = 'bucket', key_name = 'key') {
		// parse s3 spec such as: s3://my-bucket/users/kermit.json
		if (!args.other || !args.other.length) return false;
		var spec = args.other.shift() || null;
		if (!spec) return false;
		
		if (spec.match(/^s3\:\/\/([^\/]+)\/(.*)$/)) {
			args[bucket_name] = RegExp.$1;
			args[key_name] = RegExp.$2;
			
			// println( gray.bold("S3: ") + gray( args.bucket ) + gray(" (" + this.s3.region + ")") );
			return true;
		}
		else return false;
	},
	
	shiftOther(key_name) {
		// shift value from other array
		if (!args.other || !args.other.length) return false;
		var value = args.other.shift() || null;
		if (!value) return false;
		
		args[key_name] = value;
		return true;
	},
	
	addMultiFilter() {
		// add optional filter for include, exclude, newer, older, larger and smaller
		// used for uploading, downloading and deleting remote files
		var { include, exclude, newer, older, larger, smaller } = args;
		if (!include && !exclude && !newer && !older && !larger && !smaller) return;
		
		if (include) include = new RegExp(include);
		if (exclude) exclude = new RegExp(exclude);
		if (newer && (typeof(newer) == 'string')) newer = Date.parse(newer) || ((Tools.timeNow(true) - Tools.getSecondsFromText(newer)) * 1000);
		if (older && (typeof(older) == 'string')) older = Date.parse(older) || ((Tools.timeNow(true) - Tools.getSecondsFromText(older)) * 1000);
		if (larger && (typeof(larger) == 'string')) larger = Tools.getBytesFromText(larger);
		if (smaller && (typeof(smaller) == 'string')) smaller = Tools.getBytesFromText(smaller);
		
		args.filter = function(file, stats) {
			if (stats) {
				// local fs
				if (include && !file.match(include)) return false;
				if (exclude && file.match(exclude)) return false;
				if (newer && (stats.mtimeMs < newer)) return false;
				if (older && (stats.mtimeMs > older)) return false;
				if (larger && (stats.size < larger)) return false;
				if (smaller && (stats.size > smaller)) return false;
			}
			else {
				// s3 key
				if (include && !file.key.match(include)) return false;
				if (exclude && file.key.match(exclude)) return false;
				if (newer && (file.mtime < newer / 1000)) return false;
				if (older && (file.mtime > older / 1000)) return false;
				if (larger && (file.size < larger)) return false;
				if (smaller && (file.size > smaller)) return false;
			}
			return true;
		};
		
		delete args.include;
		delete args.exclude;
		delete args.newer;
		delete args.older;
		delete args.larger;
		delete args.smaller;
	},
	
	async doS3Cmd(cmd) {
		// send cmd to s3
		delete args.other;
		
		println( gray(JSON.stringify( { region: this.s3.region, ...args } )) + "\n" );
		
		try {
			var result = await this.s3[cmd](args);
			if (result && result.meta && result.meta.Body) delete result.meta.Body; // way too verbose
			println( "\n" + cli.jsonPretty(result || false) );
		}
		catch (err) {
			this.die(err);
		}
	},
	
	//
	// Custom CLI Commands (not in s3-api):
	//
	
	async cmd_help() {
		// show quick help
		var cmd = (args.other && args.other.length) ? args.other.shift() : '';
		if (cmd) {
			// quick help for specific command
			if (!CMD_HELP_TEXT[cmd]) this.die("Unknown command: " + cmd);
			var text = CMD_HELP_TEXT[cmd];
			println( "\n" + yellow.bold(cmd + ':') + " " + green(text) );
		}
		else {
			// quick help for all commands
			print("\n");
			Object.keys(CMD_HELP_TEXT).forEach( function(cmd) {
				var text = CMD_HELP_TEXT[cmd];
				println( yellow.bold(cmd + ':') + " " + green(text) );
			} );
		}
	},
	
	async cmd_docs() {
		// emit readme to stdout
		var docs = fs.readFileSync(Path.join( __dirname, 'docs/CLI.md' ), 'utf8');
		println( "\n" + docs );
	},
	
	async cmd_put() {
		// put json record
		// s3 put s3://my-bucket/users/kermit.json '{"animal:"frog", "color":"green"}'
		// s3 put s3://my-bucket/users/kermit.json --value.animal "frog" --value.color "green"
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		
		// allow json as inline string (optional)
		var raw_json = args.other.shift() || '';
		if (raw_json) {
			try { args.value = JSON.parse(raw_json); }
			catch (err) { this.die(err); }
		}
		
		await this.doS3Cmd(this.cmd);
	},
	
	async cmd_putStream() {
		// stream STDIN to S3 record (any format)
		// s3 putStream s3://my-bucket/s3dir/myfile.gif
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		
		args.value = process.stdin;
		await this.doS3Cmd(this.cmd);
	},
	
	async cmd_update() {
		// update json record
		// s3 update s3://my-bucket/users/kermit.json --update.animal "frog" --update.color "green"
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		
		// convert CLI updates to proper format for API
		args.updates = {};
		for (var key in cli.args) {
			if (key.match(/^updates?[\.\/](.+)$/)) {
				if (cli.args[key] === '_DELETE_') cli.args[key] = undefined;
				args.updates[ RegExp.$1 ] = cli.args[key];
			}
		}
		delete args.update;
		
		await this.doS3Cmd(this.cmd);
	},
	
	async cmd_get() {
		// get json record
		// s3 get s3://my-bucket/users/kermit.json
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		// await this.doS3Cmd(this.cmd);
		
		delete args.other;
		
		println( gray(JSON.stringify( { region: this.s3.region, ...args } )) + "\n" );
		
		try {
			var result = await this.s3[cmd](args);
			if (result && result.meta && result.meta.Body) delete result.meta.Body; // way too verbose
			
			if (args.pretty) println( "\n" + cli.jsonPretty( cli.args.verbose ? result : result.data ) );
			else println( "\n" + JSON.stringify( cli.args.verbose ? result : result.data ) );
			
			if (cli.args.quiet) console.log( cli.jsonPretty(result.data) );
		}
		catch (err) {
			this.die(err);
		}
	},
	
	async cmd_getStream() {
		// stream S3 record to STDOUT (any format)
		// s3 getStream s3://my-bucket/s3dir/myfile.gif
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		
		delete args.other;
		println( gray(JSON.stringify( { region: this.s3.region, ...args } )) + "\n" );
		
		try {
			var { data, meta } = await this.s3.getStream(args);
			
			// print meta in debug mode
			if (cli.args.verbose) {
				if (meta && meta.Body) delete meta.Body; // way too verbose
				println( "\n" + cli.jsonPretty(meta) );
			}
			
			// pipe stream to STDOUT
			data.pipe( process.stdout );
		}
		catch (err) {
			this.die(err);
		}
	},
	
	async cmd_head() {
		// head json record
		// s3 head s3://my-bucket/users/kermit.json
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		await this.doS3Cmd(this.cmd);
	},
	
	async cmd_list() {
		// list files
		// s3 list s3://my-bucket/s3dir
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		// await this.doS3Cmd(this.cmd);
		
		delete args.other;
		
		println( gray(JSON.stringify( { region: this.s3.region, ...args } )) + "\n" );
		
		try {
			var result = await this.s3[cmd](args);
			if (result && result.meta && result.meta.Body) delete result.meta.Body; // way too verbose
			
			if (args.json) println( "\n" + cli.jsonPretty(result || false) );
			else {
				var rows = [
					["File", "Size", "Last Modified"]
				];
				if (result && result.files) result.files.forEach( function(file) {
					rows.push([
						file.key,
						Tools.getTextFromBytes( file.size ),
						Tools.formatDate( file.mtime, "[yyyy]/[mm]/[dd] [hh]:[mi]:[ss]" )
					]);
				} );
				cli.print( 
					"\n" + cli.table(rows, {
						indent: 1,
						autoFit: true
					}) + "\n" 
				);
			}
		}
		catch (err) {
			this.die(err);
		}
	},
	
	async cmd_ls() {
		// alias for list
		cmd = this.cmd = 'list';
		await this.cmd_list();
	},
	
	async cmd_listFolders() {
		// list folders
		// s3 listFolders s3://my-bucket/s3dir
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		// await this.doS3Cmd(this.cmd);
		
		delete args.other;
		
		println( gray(JSON.stringify( { region: this.s3.region, ...args } )) + "\n" );
		
		try {
			var result = await this.s3[cmd](args);
			if (result && result.meta && result.meta.Body) delete result.meta.Body; // way too verbose
			
			if (args.json) println( "\n" + cli.jsonPretty(result || false) );
			else {
				if (result && result.folders && result.folders.length) {
					rows = [ ["Folders"] ].concat( result.folders.map( function(folder) { return [folder]; } ) );
					cli.print( 
						"\n" + cli.table(rows, {
							indent: 1,
							autoFit: true
						}) + "\n" 
					);
				}
				else {
					println( "\n" + yellow.bold("(No folders found at this level)") );
				}
				
				rows = [
					["File", "Size", "Last Modified"]
				];
				if (result && result.files && result.files.length) {
					result.files.forEach( function(file) {
						rows.push([
							file.key,
							Tools.getTextFromBytes( file.size ),
							Tools.formatDate( file.mtime, "[yyyy]/[mm]/[dd] [hh]:[mi]:[ss]" )
						]);
					} );
					cli.print( 
						"\n" + cli.table(rows, {
							indent: 1,
							autoFit: true
						}) + "\n" 
					);
				}
				else {
					println( "\n" + yellow.bold("(No files found at this level)") );
				}
			} // ascii table
		}
		catch (err) {
			this.die(err);
		}
	},
	
	async cmd_listBuckets() {
		// list all buckets
		// s3 listBuckets
		delete args.other;
		println( gray(JSON.stringify( { region: this.s3.region, ...args } )) + "\n" );
		
		try {
			var result = await this.s3[cmd](); // special call convention -- no args
			if (result && result.meta && result.meta.Body) delete result.meta.Body; // way too verbose
			
			if (args.json) println( "\n" + cli.jsonPretty(result || false) );
			else {
				var rows = [ ["Bucket Name"] ].concat( result.buckets.map( function(bucket) { return [bucket]; } ) );
				cli.print( 
					"\n" + cli.table(rows, {
						indent: 1,
						autoFit: true
					}) + "\n" 
				);
			}
		}
		catch (err) {
			this.die(err);
		}
	},
	
	async cmd_copy() {
		// copy file
		// s3 copy s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json
		this.shiftS3Spec('sourceBucket', 'sourceKey') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		await this.doS3Cmd(this.cmd);
	},
	
	async cmd_cp() {
		// alias for copy
		cmd = this.cmd = 'copy';
		await this.cmd_copy();
	},
	
	async cmd_move() {
		// move file
		// s3 move s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json
		this.shiftS3Spec('sourceBucket', 'sourceKey') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		await this.doS3Cmd(this.cmd);
	},
	
	async cmd_mv() {
		// alias for move
		cmd = this.cmd = 'move';
		await this.cmd_move();
	},
	
	async cmd_delete() {
		// delete file
		// s3 delete s3://my-bucket/s3dir/myfile.gif
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		await this.doS3Cmd(this.cmd);
	},
	
	async cmd_rm() {
		// alias for delete
		cmd = this.cmd = 'delete';
		await this.cmd_delete();
	},
	
	async cmd_upload() {
		// upload single file -- alias for uploadFile
		// s3 upload /path/to/image.gif s3://my-bucket/s3dir/myfile.gif
		this.shiftOther('localFile') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		await this.doS3Cmd('uploadFile');
	},
	
	async cmd_download() {
		// upload single file -- alias for downloadFile
		// s3 download s3://my-bucket/s3dir/myfile.gif /path/to/image.gif
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		this.shiftOther('localFile') || this.dieUsage(this.cmd);
		await this.doS3Cmd('downloadFile');
	},
	
	async cmd_uploadFiles() {
		// upload folder
		// s3 uploadFiles /path/to/images s3://my-bucket/s3dir/uploaded
		this.shiftOther('localPath') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		await this.doS3Cmd(this.cmd);
	},
	
	async cmd_downloadFiles() {
		// download folder
		// s3 downloadFiles s3://my-bucket/s3dir/uploaded /path/to/images
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		this.shiftOther('localPath') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		await this.doS3Cmd(this.cmd);
	},
	
	async cmd_deleteFiles() {
		// delete folder
		// s3 deleteFiles s3://my-bucket/s3dir/uploaded --filespec '\\.gif$'
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		await this.doS3Cmd(this.cmd);
	},
	
	async cmd_snapshot() {
		// download s3 folder to temp dir, then zip or tar it up
		// s3 snapshot s3://my-bucket/s3dir/images /path/to/backup-[yyyy]-[mm]-[dd].zip
		// { remotePath, localFile }
		var self = this;
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		this.shiftOther('localFile') || this.dieUsage(this.cmd);
		
		delete args.other;
		println( gray(JSON.stringify( { region: this.s3.region, ...args } )) + "\n" );
		
		var arch_file = args.localFile || this.dieUsage(this.cmd);
		delete args.localFile;
		
		// allow archiveFile to have date/time placeholders, e.g. `my-backup-[yyyy]-[mm]-[dd].zip`
		arch_file = Tools.formatDate( Tools.timeNow(), arch_file );
		
		// arch file needs to be absolute
		arch_file = Path.resolve(arch_file);
		
		// server must have appropriate binary somewhere in PATH or common dirs
		var arch_cmd = '';
		if (arch_file.match(/\.zip$/i)) {
			var zip_bin = Tools.findBinSync('zip') || this.die('Cannot locate `zip` binary.');
			var zip_args = args.zipArgs || '-r';
			arch_cmd = `${zip_bin} ${zip_args} "${arch_file}" .`;
		}
		else if (arch_file.match(/\.tar(\.gz)?$/i)) {
			var tar_bin = Tools.findBinSync('tar') || this.die('Cannot locate `tar` binary.');
			var tar_args = args.tarArgs || (arch_file.match(/\.gz$/i) ? '-zcvf' : '-cvf');
			arch_cmd = `${tar_bin} ${tar_args} "${arch_file}" .`;
		}
		else this.die('Unsupported archive format: ' + arch_file);
		
		// reroute download to temp dir
		args.localPath = Path.join( TEMP_DIR, 's3-temp-' + process.pid );
		
		// do the download
		try {
			await this.s3.downloadFiles(args);
		}
		catch (err) {
			this.die(err);
		}
		
		// create local parent dirs for the archive if needed
		try {
			Tools.mkdirp.sync( Path.dirname(arch_file) );
		}
		catch (err) {
			this.die(err);
		}
		
		// zip the dir
		try {
			this.s3.logDebug(9, "Compressing archive", arch_cmd);
			var output = cp.execSync( arch_cmd + ' 2>&1', {
				cwd: args.localPath,
				maxBuffer: 1024 * 1024 * 32
			} );
			this.s3.logDebug(9, "Archive compression complete", '' + output);
		}
		catch (err) {
			if (err.stdout) console.log('' + err.stdout);
			if (err.stderr) console.error('' + err.stderr);
			this.die(err);
		}
		
		// delete the dir
		this.s3.logDebug(9, "Deleting temp dir", args.localPath);
		Tools.rimraf.sync(args.localPath);
		
		// optionally expire old snaps
		if (args.expire) {
			var expire_at = Tools.timeNow(true) - Tools.getSecondsFromText(args.expire);
			
			Tools.findFilesSync( Path.dirname(arch_file), {
				recurse: false,
				filter: function(file, stats) {
					return (stats.mtimeMs / 1000) <= expire_at;
				}
			}).forEach( function(file) {
				self.s3.logDebug(5, "Deleting expired snapshot: " + file);
				fs.unlinkSync(file);
			} );
		}
		
		// and we're done
		println( "\n" + cyan.bold("Snapshot written to: ") + yellow.bold(arch_file) );
	},
	
	async cmd_restoreSnapshot() {
		// expand local archive, upload files to s3
		// s3 restoreSnapshot /path/to/backup-2024-05-22.zip s3://my-bucket/s3dir/images
		// { remotePath, localFile, delete?, threads? }
		this.shiftOther('localFile') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		
		delete args.other;
		println( gray(JSON.stringify( { region: this.s3.region, ...args } )) + "\n" );
		
		var arch_file = args.localFile || this.dieUsage(this.cmd);
		delete args.localFile;
		
		// arch file needs to be absolute
		arch_file = Path.resolve(arch_file);
		
		// create temp dir
		var temp_dir = Path.join( TEMP_DIR, 's3-temp-' + process.pid );
		try {
			Tools.mkdirp.sync( temp_dir );
		}
		catch (err) {
			this.die(err);
		}
		
		// expand archive into temp dir
		var arch_cmd = '';
		if (arch_file.match(/\.zip$/i)) {
			var unzip_bin = Tools.findBinSync('unzip') || this.die('Cannot locate `unzip` binary.');
			arch_cmd = `${unzip_bin} "${arch_file}"`;
		}
		else if (arch_file.match(/\.tar\.gz$/i)) {
			var tar_bin = Tools.findBinSync('tar') || this.die('Cannot locate `tar` binary.');
			arch_cmd = `${tar_bin} -zxvf "${arch_file}"`;
		}
		else this.die('Unsupported archive format: ' + arch_file);
		
		// do the expansion
		try {
			this.s3.logDebug(9, "Expanding archive", arch_cmd);
			var output = cp.execSync( arch_cmd + ' 2>&1', {
				cwd: temp_dir,
				maxBuffer: 1024 * 1024 * 32
			} );
			this.s3.logDebug(9, "Archive expansion complete", '' + output);
		}
		catch (err) {
			if (err.stdout) console.log('' + err.stdout);
			if (err.stderr) console.error('' + err.stderr);
			this.die(err);
		}
		
		// optionally pre-delete s3 destination
		if (args.delete) {
			try {
				await this.s3.deleteFiles(args);
			}
			catch (err) {
				this.die(err);
			}
		}
		
		// do the upload
		args.localPath = temp_dir;
		try {
			await this.s3.uploadFiles(args);
		}
		catch (err) {
			this.die(err);
		}
		
		// delete temp dir
		this.s3.logDebug(9, "Deleting temp dir", temp_dir);
		Tools.rimraf.sync(temp_dir);
		
		println( "\n" + cyan.bold("Snapshot restored to: ") + yellow.bold('s3://' + args.bucket + '/' + args.remotePath) );
	},
	
	async cmd_backup() {
		// backup local files to s3 as compressed archive
		// s3 backup /path/to/files s3://my-bucket/backups/mybackup-[yyyy]-[mm]-[dd].zip
		this.shiftOther('localPath') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		
		delete args.other;
		println( gray(JSON.stringify( { region: this.s3.region, ...args } )) + "\n" );
		
		var src_path = args.localPath;
		delete args.localPath;
		
		// allow s3 key to have date/time placeholders, e.g. `my-backup-[yyyy]-[mm]-[dd].zip`
		args.key = Tools.formatDate( Tools.timeNow(), args.key );
		
		var arch_file = Path.join( TEMP_DIR, 's3-temp-' + process.pid );
		var arch_cmd = '';
		
		if (args.key.match(/(\.zip)$/i)) {
			arch_file += RegExp.$1;
			var zip_bin = Tools.findBinSync('zip') || this.die('Cannot locate `zip` binary.');
			var zip_args = args.zipArgs || '-r';
			arch_cmd = `${zip_bin} ${zip_args} "${arch_file}" .`;
		}
		else if (args.key.match(/(\.tar|\.tar\.gz)$/i)) {
			arch_file += RegExp.$1;
			var tar_bin = Tools.findBinSync('tar') || this.die('Cannot locate `tar` binary.');
			var tar_args = args.tarArgs || (arch_file.match(/\.gz$/i) ? '-zcvf' : '-cvf');
			arch_cmd = `${tar_bin} ${tar_args} "${arch_file}" .`;
		}
		else this.die('Unsupported archive format: ' + args.key);
		
		// zip the local dir
		try {
			this.s3.logDebug(9, "Compressing archive", arch_cmd);
			var output = cp.execSync( arch_cmd + ' 2>&1', {
				cwd: src_path,
				maxBuffer: 1024 * 1024 * 32
			} );
			this.s3.logDebug(9, "Archive compression complete", '' + output);
		}
		catch (err) {
			if (err.stdout) console.log('' + err.stdout);
			if (err.stderr) console.error('' + err.stderr);
			this.die(err);
		}
		
		// upload the arch file
		args.localFile = arch_file;
		try {
			await this.s3.uploadFile(args);
		}
		catch (err) {
			this.die(err);
		}
		
		// delete temp file
		fs.unlinkSync( arch_file );
		
		// optionally expire old backups
		if (args.expire) {
			args.older = args.expire;
			args.remotePath = Path.dirname(args.key);
			delete args.value;
			
			try {
				await this.s3.deleteFiles(args);
			}
			catch (err) {
				this.die(err);
			}
		}
		
		// and we're done
		println( "\n" + cyan.bold("Backup saved to: ") + yellow.bold('s3://' + args.bucket + '/' + args.key) );
	},
	
	async cmd_restoreBackup() {
		// download and restore backup to local filesystem
		// s3 restoreBackup s3://my-bucket/backups/mybackup-2024-05-22.zip /path/to/files
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		this.shiftOther('localPath') || this.dieUsage(this.cmd);
		
		delete args.other;
		println( gray(JSON.stringify( { region: this.s3.region, ...args } )) + "\n" );
		
		var dest_path = Path.resolve(args.localPath);
		delete args.localPath;
		
		var arch_file = Path.join( TEMP_DIR, 's3-temp-' + process.pid );
		var arch_cmd = '';
		
		if (args.key.match(/\.zip$/i)) {
			var unzip_bin = Tools.findBinSync('unzip') || this.die('Cannot locate `unzip` binary.');
			arch_file += '.zip';
			arch_cmd = `${unzip_bin} -o "${arch_file}"`;
		}
		else if (args.key.match(/\.tar\.gz$/i)) {
			var tar_bin = Tools.findBinSync('tar') || this.die('Cannot locate `tar` binary.');
			arch_file += '.tar.gz';
			arch_cmd = `${tar_bin} -zxvf "${arch_file}"`;
		}
		else this.die('Unsupported archive format: ' + args.key);
		
		// download archive to temp location
		args.localFile = arch_file;
		try {
			await this.s3.downloadFile(args);
		}
		catch (err) {
			this.die(err);
		}
		
		// possibly delete files first
		if (args.delete && fs.existsSync(dest_path)) {
			try { Tools.rimraf.sync(dest_path); }
			catch (err) { this.die(err); }
		}
		
		// create dir if needed
		if (!fs.existsSync(dest_path)) {
			try { Tools.mkdirp.sync(dest_path); }
			catch (err) { this.die(err); }
		}
		
		// expand archive into dir
		try {
			this.s3.logDebug(9, "Expanding archive", arch_cmd);
			var output = cp.execSync( arch_cmd + ' 2>&1', {
				cwd: dest_path,
				maxBuffer: 1024 * 1024 * 32
			} );
			this.s3.logDebug(9, "Archive expansion complete", '' + output);
		}
		catch (err) {
			if (err.stdout) console.log('' + err.stdout);
			if (err.stderr) console.error('' + err.stderr);
			this.die(err);
		}
		
		// delete temp archive file
		fs.unlinkSync( arch_file );
		
		// and we're done
		println( "\n" + cyan.bold("Backup restored to: ") + yellow.bold(dest_path) );
	}
	
}; // app

app.run();