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

cli.mapArgs({
	'r': 'recursive',
	'v': 'verbose',
	'q': 'quiet',
	'c': 'color',
	'p': 'pretty',
	't': 'threads',
	'd': 'dry',
	
	'temp': 'tempDir',
	'tmp': 'tempDir',
	'tmpdir': 'tempDir',
	'tmpDir': 'tempDir',
	'temp-dir': 'tempDir',
	'temp_dir': 'tempDir',
	'tmp-dir': 'tempDir',
	'tmp_dir': 'tempDir',
	
	'dryrun': 'dry',
	'dryRun': 'dry',
	'dry-run': 'dry',
	'dry_run': 'dry',
	
	'acl': 'params.ACL',
	'class': 'params.StorageClass',
	'debug': 'verbose'
});

// override defaults for progress bar signal handling
cli.progress.defaults.catchInt = true;
cli.progress.defaults.catchTerm = true;
cli.progress.defaults.catchCrash = true;
cli.progress.defaults.exitOnSig = true;

// optional config file for args defaults
const config_file = Path.join( process.env.HOME, '.s3-config.json' );
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
for (let key in cli.args) {
	if (cli.args[key] === 'true') cli.args[key] = true;
	else if (cli.args[key] === 'false') cli.args[key] = false;
}

// allow cli.args to be dot.path.syntax, import into args
let args = {};
for (let key in cli.args) {
	Tools.setPath( args, key, cli.args[key] );
}

if (!args.other || !args.other.length || args.help || args.h) args.other = ['help'];
let cmd = args.other.shift();

const S3 = require('.');

const S3_URL_RE = /^(s3:\/\/|s3:|\/\/)([^\/]+)\/(.*)$/i;

const CMD_HELP_TEXT = {
	"docs": `s3 docs`,
	"put": "s3 put S3_URL RAW_JSON",
	"putStream": "s3 putStream S3_URL [--KEY VALUE...]",
	"update": "s3 update S3_URL --update.KEY \"VALUE\" [--update.KEY \"VALUE\" ...]",
	"get": "s3 get S3_URL [--KEY VALUE...]",
	"getStream": "s3 getStream S3_URL [--KEY VALUE...]",
	"head": "s3 head S3_URL",
	"list": "s3 list S3_URL [--KEY VALUE...]",
	"listFolders": "s3 listFolders S3_URL [--KEY VALUE...]",
	"listBuckets": "s3 listBuckets [--KEY VALUE...]",
	"grep": "s3 grep REGEX S3_URL/",
	"copy": "s3 copy S3_URL_OR_LOCAL_PATH S3_URL_OR_LOCAL_PATH",
	"copyFile": "s3 copyFile S3_SRC_URL S3_DEST_URL [--KEY VALUE...]",
	"copyFiles": "s3 copyFiles S3_SRC_URL/ S3_DEST_URL/ [--KEY VALUE...]",
	"move": "s3 copy S3_URL_OR_LOCAL_PATH S3_URL_OR_LOCAL_PATH",
	"moveFile": "s3 moveFile S3_SRC_URL S3_DEST_URL [--KEY VALUE...]",
	"moveFiles": "s3 moveFiles S3_SRC_URL/ S3_DEST_URL/ [--KEY VALUE...]",
	"deleteFile": "s3 deleteFile S3_URL [--KEY VALUE...]",
	"deleteFiles": "s3 deleteFiles S3_URL/ [--KEY VALUE...]",
	"uploadFile": "s3 uploadFile LOCAL_FILE S3_URL [--KEY VALUE...]",
	"uploadFiles": "s3 uploadFiles LOCAL_DIR/ S3_URL/ [--KEY VALUE...]",
	"downloadFile": "s3 downloadFile S3_URL LOCAL_FILE [--KEY VALUE...]",
	"downloadFiles": "s3 downloadFiles S3_URL/ LOCAL_DIR/ [--KEY VALUE...]",
	"snapshot": "s3 snapshot S3_URL/ LOCAL_FILE [--KEY VALUE...]",
	"restoreSnapshot": "s3 restoreSnapshot LOCAL_FILE S3_URL/ [--KEY VALUE...]",
	"backup": "s3 backup LOCAL_DIR/ S3_URL [--KEY VALUE...]",
	"restoreBackup": "s3 restoreBackup S3_URL LOCAL_DIR/ [--KEY VALUE...]"
};

const CMD_ALIASES = {
	ls: 'list',
	lf: 'listFolders',
	lb: 'listBuckets',
	cp: 'copy',
	mv: 'move',
	delete: 'deleteFile',
	rm: 'deleteFile',
	upload: 'uploadFile',
	up: 'uploadFile',
	download: 'downloadFile',
	dl: 'downloadFile',
	snap: 'snapshot',
	rs: 'restoreSnapshot',
	bk: 'backup',
	rb: 'restoreBackup'
};

const app = {
	
	async run() {
		// main entry point
		let self = this;
		
		// Prevent EPIPE in case we get closed early, e.g. | head
		process.stdout.on('error', function() { process.exit(0); });
		
		// copy some args over to S3 API
		let s3_args = {};
		for (let key in args) {
			if (key.match(/^(region|bucket|credentials|prefix|params|gzip|timeout|connectTimeout|retries|endpoint|forcePathStyle)$/)) {
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
				let result = await this.s3[cmd](args);
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
	
	markdown(text) {
		// poor man's markdown-to-ANSI-color
		text = text.toString();
		
		// HTML removal, spacing cleanup
		text = text.replace(/<details>[\s\S]*?<\/details>/g, '');
		text = text.replace(/<.+?>/g, '').replace(/^[^\#]+\#/, '#').trim();
		text = text.replace(/\&\w+\;/g, '');
		text = text.replace(/\n{3,}/g, "\n\n");
		
		// links
		text = text.replace( /\[([\w\s\-\.\'\/\(\)]+?)\]\((.+?)\)/g, function(m_all, m_g1, m_g2) {
			if (m_g2.match(/^\#/)) return '' + yellow.bold.underline(m_g1) + '';
			else return '' + yellow.bold.underline(m_g2) + '';
		} );
		
		// headings
		text = text.replace( /(^|\n)(\#\#+)\s*([^\n]+)/g, function(m_all, m_g1, m_g2, m_g3) {
			return m_g1 + gray(m_g2) + ' ' + magenta.bold(m_g3);
		} );
		
		// code blocks
		text = text.replace( /(\n\`\`\`)(\w+)\n([\S\s]+?)(\n\`\`\`)/g, function(m_all, m_g1, m_g2, m_g3, m_g4) {
			// return "\n" + bold.gray( m_g3.trim() );
			return "\n" + m_g3.trim().split(/\n/).map( function(line) {
				if (line.match(/^\#/)) return green(line);
				else return bold.gray(line);
			} ).join("\n");
		});
		text = text.replace( /(\n\`\`\`\n)([\S\s]+?)(\n\`\`\`)/g, function(m_all, m_g1, m_g2, m_g3, m_g4) {
			return "\n" + bold.gray( m_g2.trim() );
		});
		
		// inline formatting
		text = text.replace( /\`(.+?)\`/g, function(m_all, m_g1) {
			return '`' + cyan.bold(m_g1) + '`';
		} );
		text = text.replace( /\*\*(.+?)\*\*/g, function(m_all, m_g1) {
			return '' + yellow.bold(m_g1) + '';
		} );
		text = text.replace( /\*(.+?)\*/g, function(m_all, m_g1) {
			return '' + yellow(m_g1) + '';
		} );
		
		// lists
		text = text.replace( /\n(\t*\-) ([^\n]+)/g, function(m_all, m_g1, m_g2) {
			return "\n" + yellow.bold(m_g1) + ' ' + cyan(m_g2);
		});
		
		// tables
		text = text.replace( /\n(\|)([^\n]+)/g, function(m_all, m_g1, m_g2) {
			let cols = m_g2.replace(/\|\s*$/, '').split(/\s+\|\s+/).map( function(col) { return yellow(col.trim()); } );
			return "\n" + gray.bold('| ') + cols.join( gray.bold(' | ') ) + gray.bold(' |');
		});
		
		return text;
	},
	
	shiftS3Spec(bucket_name = 'bucket', key_name = 'key') {
		// parse s3 spec such as: s3://my-bucket/users/kermit.json
		if (!args.other || !args.other.length) return false;
		let spec = args.other.shift() || null;
		if (!spec) return false;
		
		if (spec.match(S3_URL_RE)) {
			args[bucket_name] = RegExp.$2;
			args[key_name] = RegExp.$3;
			return true;
		}
		else return false;
	},
	
	shiftOther(key_name) {
		// shift value from other array
		if (!args.other || !args.other.length) return false;
		let value = args.other.shift() || null;
		if (!value) return false;
		
		args[key_name] = value;
		return true;
	},
	
	addMultiFilter() {
		// add optional filter for include, exclude, newer, older, larger and smaller
		// used for uploading, downloading and deleting remote files
		let { include, exclude, newer, older, larger, smaller } = args;
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
	
	progressHandler(progress) {
		// show progress of file upload/download
		if (progress && progress.total && progress.loaded) {
			cli.progress.update({
				amount: progress.loaded / progress.total,
				text: gray( '(' + Tools.getTextFromBytes(progress.loaded) + ' of ' + Tools.getTextFromBytes(progress.total) + ')' )
			});
		}
		else if (progress && progress.loaded) {
			// indeterminate (i.e. gzip stream)
			cli.progress.update({
				amount: 1,
				text: gray( '(' + Tools.getTextFromBytes(progress.loaded) + ')' )
			});
		}
	},
	
	printArgSummary() {
		// print list of args
		println( gray(JSON.stringify( { command: cmd, endpoint: this.s3.endpoint || undefined, region: this.s3.region, ...args } )) + "\n" );
	},
	
	async callS3API(cmd) {
		// send cmd to s3
		delete args.other;
		this.printArgSummary();
		
		try {
			let result = await this.s3[cmd](args);
			if (result && result.meta && result.meta.Body) delete result.meta.Body; // way too verbose
			verboseln( "\n" + cli.jsonPretty(result || false) );
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
		let hcmd = (args.other && args.other.length) ? args.other.shift() : '';
		if (hcmd) {
			
			// allow for `s3 help cp` -- gotta resolve aliases here!
			if (CMD_ALIASES[hcmd]) hcmd = CMD_ALIASES[hcmd];
			
			// detailed help for specific command
			if (!CMD_HELP_TEXT[hcmd]) this.die("Unknown command: " + hcmd);
			// let text = CMD_HELP_TEXT[hcmd];
			// println( "\n" + yellow.bold(hcmd + ':') + " " + green(text) );
			
			let docs = fs.readFileSync(Path.join( __dirname, 'docs/CLI.md' ), 'utf8');
			let re = new RegExp('\\n(\\#\\#\\#\\s+' + hcmd + '\\n[\\S\\s]+?)\\n\\#\#+');
			if (docs.match(re)) {
				let section = RegExp.$1;
				println( "\n" + this.markdown(section) );
			}
			else this.die("No help found for command: " + hcmd);
		}
		else {
			// quick help for all commands
			print("\n");
			
			Object.keys(CMD_HELP_TEXT).forEach( function(ecmd) {
				let text = CMD_HELP_TEXT[ecmd];
				println( yellow.bold(ecmd + ':') + " " + green(text) );
			} );
			
			println("\n" + green.bold("Type " + cyan.bold("`s3 help COMMAND`") + " for details on a specific command.") );
		}
	},
	
	async cmd_docs() {
		// emit readme to stdout, format markdown
		let docs = fs.readFileSync(Path.join( __dirname, 'docs/CLI.md' ), 'utf8');
		println( "\n" + this.markdown(docs) );
	},
	
	async cmd_put() {
		// put json record
		// s3 put s3://my-bucket/users/kermit.json '{"animal:"frog", "color":"green"}'
		// s3 put s3://my-bucket/users/kermit.json --value.animal "frog" --value.color "green"
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		
		// allow json as inline string (optional)
		let raw_json = args.other.shift() || '';
		if (raw_json) {
			try { args.value = JSON.parse(raw_json); }
			catch (err) { this.die(err); }
		}
		
		await this.callS3API(this.cmd);
	},
	
	async cmd_putStream() {
		// stream STDIN to S3 record (any format)
		// s3 putStream s3://my-bucket/s3dir/myfile.gif
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		
		args.value = process.stdin;
		await this.callS3API(this.cmd);
	},
	
	async cmd_update() {
		// update json record
		// s3 update s3://my-bucket/users/kermit.json --update.animal "frog" --update.color "green"
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		
		// convert CLI updates to proper format for API
		args.updates = {};
		for (let key in cli.args) {
			if (key.match(/^updates?[\.\/](.+)$/)) {
				if (cli.args[key] === '_DELETE_') cli.args[key] = undefined;
				args.updates[ RegExp.$1 ] = cli.args[key];
			}
		}
		delete args.update;
		
		await this.callS3API(this.cmd);
	},
	
	async cmd_get() {
		// get json record
		// s3 get s3://my-bucket/users/kermit.json
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		// await this.callS3API(this.cmd);
		
		delete args.other;
		this.printArgSummary();
		
		try {
			let result = await this.s3[cmd](args);
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
		this.printArgSummary();
		
		try {
			let { data, meta } = await this.s3.getStream(args);
			
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
		// await this.callS3API(this.cmd);
		
		delete args.other;
		this.printArgSummary();
		
		try {
			let result = await this.s3[cmd](args);
			if (result && result.meta && result.meta.Body) delete result.meta.Body; // way too verbose
			
			if (args.pretty) println( "\n" + cli.jsonPretty( result ) );
			else println( "\n" + JSON.stringify( result ) );
			
			if (cli.args.quiet) console.log( cli.jsonPretty(result) );
		}
		catch (err) {
			this.die(err);
		}
	},
	
	async cmd_list() {
		// list files
		// s3 list s3://my-bucket/s3dir
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		// await this.callS3API(this.cmd);
		
		delete args.other;
		this.printArgSummary();
		
		try {
			let result = await this.s3[cmd](args);
			if (result && result.meta && result.meta.Body) delete result.meta.Body; // way too verbose
			
			if (args.json) {
				// json output mode
				print("\n");
				console.log( cli.jsonPretty(result || false) );
			}
			else if (args.csv) {
				// csv output mode
				let rows = [ 'Path,Size,Bytes,Modified,Epoch' ];
				
				rows = rows.concat( (result.files || []).map( function(file) {
					return '"' + [
						file.key, 
						Tools.getTextFromBytes( file.size ), 
						file.size,
						Tools.formatDate( file.mtime, "[yyyy]/[mm]/[dd] [hh]:[mi]:[ss]" ),
						file.mtime
					].join('","') + '"';
				} ) );
				
				print("\n");
				console.log( rows.join("\n") );
			}
			else {
				// standard (ascii table) output mode
				let rows = [
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
		// await this.callS3API(this.cmd);
		
		delete args.other;
		this.printArgSummary();
		
		try {
			let result = await this.s3[cmd](args);
			if (result && result.meta && result.meta.Body) delete result.meta.Body; // way too verbose
			
			if (args.json) {
				// json output mode
				print("\n");
				console.log( cli.jsonPretty(result || false) );
			}
			else if (args.csv) {
				// csv output mode
				let rows = [ 'Path,Size,Bytes,Modified,Epoch' ];
				
				rows = rows.concat( (result.folders || []).map( function(folder) {
					return '"' + [
						folder, 
						'-', 
						0,
						'-',
						0
					].join('","') + '"';
				} ) );
				
				rows = rows.concat( (result.files || []).map( function(file) {
					return '"' + [
						file.key, 
						Tools.getTextFromBytes( file.size ), 
						file.size,
						Tools.formatDate( file.mtime, "[yyyy]/[mm]/[dd] [hh]:[mi]:[ss]" ),
						file.mtime
					].join('","') + '"';
				} ) );
				
				print("\n");
				console.log( rows.join("\n") );
			}
			else {
				// standard (ascii table) output mode
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
	
	async cmd_lf() {
		// alias for listFolders
		cmd = this.cmd = 'listFolders';
		await this.cmd_listFolders();
	},
	
	async cmd_listBuckets() {
		// list all buckets
		// s3 listBuckets
		
		delete args.other;
		this.printArgSummary();
		
		try {
			let result = await this.s3[cmd](); // special call convention -- no args
			if (result && result.meta && result.meta.Body) delete result.meta.Body; // way too verbose
			
			if (args.json) {
				// json output mode
				print("\n");
				console.log( cli.jsonPretty(result || false) );
			}
			else if (args.csv) {
				// csv output mode
				print("\n");
				console.log( result.buckets.join("\n") );
			}
			else {
				// standard (ascii table) output mode
				let rows = [ ["Bucket Name"] ].concat( result.buckets.map( function(bucket) { return [bucket]; } ) );
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
	
	async cmd_lb() {
		// alias for listBuckets
		cmd = this.cmd = 'listBuckets';
		await this.cmd_listBuckets();
	},
	
	async cmd_copy() {
		// copy file
		// s3 copy s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json
		
		// allow copy to jump over to upload / download as needed
		if (args.other && (args.other.length >= 2)) {
			if (args.other[0].match(S3_URL_RE) && !args.other[1].match(S3_URL_RE)) {
				cmd = this.cmd = 'download';
				return await this.cmd_download();
			}
			else if (!args.other[0].match(S3_URL_RE) && args.other[1].match(S3_URL_RE)) {
				cmd = this.cmd = 'upload';
				return await this.cmd_upload();
			}
		}
		
		// default to copyFile
		cmd = this.cmd = 'copyFile';
		await this.cmd_copyFile();
	},
	
	async cmd_cp() {
		// alias for copy
		cmd = this.cmd = 'copy';
		await this.cmd_copy();
	},
	
	async cmd_copyFile() {
		// copy file
		// s3 copy s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json
		
		// allow --recursive to jump over to copyFiles
		if (args.recursive) {
			delete args.recursive;
			cmd = this.cmd = 'copyFiles';
			return await this.cmd_copyFiles();
		}
		
		this.shiftS3Spec('sourceBucket', 'sourceKey') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		await this.callS3API('copyFile');
	},
	
	async cmd_copyFiles() {
		// copy files
		// s3 copyFiles s3://my-bucket/users s3://my-bucket/newusers
		this.shiftS3Spec('sourceBucket', 'remotePath') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'destPath') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		
		// show progress if we have a tty
		if (cli.tty()) {
			cli.progress.start();
			args.progress = this.progressHandler;
		}
		
		await this.callS3API(this.cmd);
		
		cli.progress.end();
	},
	
	async cmd_move() {
		// move file
		// s3 move s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json
		
		// allow move to jump over to upload / download (with delete) as needed
		if (args.other && (args.other.length >= 2)) {
			if (args.other[0].match(S3_URL_RE) && !args.other[1].match(S3_URL_RE)) {
				args.delete = true;
				cmd = this.cmd = 'download';
				return await this.cmd_download();
			}
			else if (!args.other[0].match(S3_URL_RE) && args.other[1].match(S3_URL_RE)) {
				args.delete = true;
				cmd = this.cmd = 'upload';
				return await this.cmd_upload();
			}
		}
		
		// default to moveFile
		cmd = this.cmd = 'moveFile';
		await this.cmd_moveFile();
	},
	
	async cmd_mv() {
		// alias for move
		cmd = this.cmd = 'move';
		await this.cmd_move();
	},
	
	async cmd_moveFile() {
		// move file
		// s3 move s3://my-bucket/users/oldkermit.json s3://my-bucket/users/newkermit.json
		
		// allow --recursive to jump over to moveFiles
		if (args.recursive) {
			delete args.recursive;
			cmd = this.cmd = 'moveFiles';
			return await this.cmd_moveFiles();
		}
		
		this.shiftS3Spec('sourceBucket', 'sourceKey') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		await this.callS3API('moveFile');
	},
	
	async cmd_moveFiles() {
		// move files
		// s3 moveFiles s3://my-bucket/users s3://my-bucket/newusers
		this.shiftS3Spec('sourceBucket', 'remotePath') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'destPath') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		
		// show progress if we have a tty
		if (cli.tty()) {
			cli.progress.start();
			args.progress = this.progressHandler;
		}
		
		await this.callS3API(this.cmd);
		
		cli.progress.end();
	},
	
	async cmd_deleteFile() {
		// delete file
		// s3 deleteFile s3://my-bucket/s3dir/myfile.gif
		
		// allow --recursive to jump over to deleteFiles
		if (args.recursive) {
			delete args.recursive;
			cmd = this.cmd = 'deleteFiles';
			return await this.cmd_deleteFiles();
		}
		
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		await this.callS3API('deleteFile');
	},
	
	async cmd_delete() {
		// alias for deleteFile
		cmd = this.cmd = 'deleteFile';
		await this.cmd_deleteFile();
	},
	
	async cmd_rm() {
		// alias for deleteFile
		cmd = this.cmd = 'deleteFile';
		await this.cmd_deleteFile();
	},
	
	async cmd_uploadFile() {
		// upload single file -- alias for uploadFile
		// s3 uploadFile /path/to/image.gif s3://my-bucket/s3dir/myfile.gif
		
		// allow --recursive to jump over to uploadFiles
		if (args.recursive) {
			delete args.recursive;
			cmd = this.cmd = 'uploadFiles';
			return await this.cmd_uploadFiles();
		}
		
		// show progress if we have a tty
		if (cli.tty()) {
			cli.progress.start({
				pct: args.compress ? false : true,
				amount: args.compress ? 1 : 0,
				max: 1
			});
			args.progress = this.progressHandler;
		}
		
		this.shiftOther('localFile') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		await this.callS3API('uploadFile');
		
		cli.progress.end();
	},
	
	async cmd_upload() {
		// alias for uploadFile
		cmd = this.cmd = 'uploadFile';
		await this.cmd_uploadFile();
	},
	
	async cmd_up() {
		// alias for uploadFile
		cmd = this.cmd = 'uploadFile';
		await this.cmd_uploadFile();
	},
	
	async cmd_ul() {
		// alias for uploadFile
		cmd = this.cmd = 'uploadFile';
		await this.cmd_uploadFile();
	},
	
	async cmd_downloadFile() {
		// upload single file -- alias for downloadFile
		// s3 downloadFile s3://my-bucket/s3dir/myfile.gif /path/to/image.gif
		
		// allow --recursive to jump over to downloadFiles
		if (args.recursive) {
			delete args.recursive;
			cmd = this.cmd = 'downloadFiles';
			return await this.cmd_downloadFiles();
		}
		
		// show progress if we have a tty
		if (cli.tty()) {
			cli.progress.start();
			args.progress = this.progressHandler;
		}
		
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		this.shiftOther('localFile') || this.dieUsage(this.cmd);
		await this.callS3API('downloadFile');
		
		cli.progress.end();
	},
	
	async cmd_download() {
		// alias for downloadFile
		cmd = this.cmd = 'downloadFile';
		await this.cmd_downloadFile();
	},
	
	async cmd_dl() {
		// alias for downloadFile
		cmd = this.cmd = 'downloadFile';
		await this.cmd_downloadFile();
	},
	
	async cmd_uploadFiles() {
		// upload folder
		// s3 uploadFiles /path/to/images s3://my-bucket/s3dir/uploaded
		this.shiftOther('localPath') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		
		// show progress if we have a tty
		if (cli.tty()) {
			cli.progress.start();
			args.progress = this.progressHandler;
		}
		
		await this.callS3API(this.cmd);
		
		cli.progress.end();
	},
	
	async cmd_downloadFiles() {
		// download folder
		// s3 downloadFiles s3://my-bucket/s3dir/uploaded /path/to/images
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		this.shiftOther('localPath') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		
		// show progress if we have a tty
		if (cli.tty()) {
			cli.progress.start();
			args.progress = this.progressHandler;
		}
		
		await this.callS3API(this.cmd);
		
		cli.progress.end();
	},
	
	async cmd_deleteFiles() {
		// delete folder
		// s3 deleteFiles s3://my-bucket/s3dir/uploaded --filespec '\\.gif$'
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		
		// show progress if we have a tty
		if (cli.tty()) {
			cli.progress.start();
			args.progress = this.progressHandler;
		}
		
		await this.callS3API(this.cmd);
		
		cli.progress.end();
	},
	
	async cmd_grep() {
		// recursively grep s3 files for match
		let self = this;
		this.shiftOther('match') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		
		delete args.other;
		this.printArgSummary();
		
		if (args.match) args.match = new RegExp(args.match);
		if (args.max) { args.maxLines = args.max; delete args.max; }
		
		args.iterator = function(line, file) {
			console.log( yellow(file.key + ": ") + line.trim() );
		};
		
		try {
			await this.s3.grepFiles(args);
		}
		catch (err) {
			this.die(err);
		}
	},
	
	async cmd_snapshot() {
		// download s3 folder to temp dir, then zip or tar it up
		// s3 snapshot s3://my-bucket/s3dir/images /path/to/backup-[yyyy]-[mm]-[dd].zip
		// { remotePath, localFile }
		let self = this;
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		this.shiftOther('localFile') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		
		delete args.other;
		this.printArgSummary();
		
		let arch_file = args.localFile || this.dieUsage(this.cmd);
		delete args.localFile;
		
		// arch file needs to be absolute
		arch_file = Path.resolve(arch_file);
		
		// determine the "true" base dir, outside of any macros
		let base_dir = Path.dirname(arch_file);	
		while (base_dir.match(/\[/)) { base_dir = Path.dirname(base_dir); }
		if (args.expire && (base_dir === '/')) this.die("Cannot expire snapshots at root directory.");
		
		// allow archiveFile to have date/time placeholders, e.g. `my-backup-[yyyy]-[mm]-[dd].zip`
		arch_file = Tools.formatDate( Tools.timeNow(), arch_file );
		
		// server must have appropriate binary somewhere in PATH or common dirs
		let arch_cmd = '';
		if (arch_file.match(/\.zip$/i)) {
			let zip_bin = Tools.findBinSync('zip') || this.die('Cannot locate `zip` binary.');
			let zip_args = args.zipArgs || '-r';
			arch_cmd = `${zip_bin} ${zip_args} "${arch_file}" .`;
		}
		else if (arch_file.match(/\.tar(\.gz|\.xz|\.bz2)?$/i)) {
			let tar_bin = Tools.findBinSync('tar') || this.die('Cannot locate `tar` binary.');
			let tar_args = args.tarArgs || '-acvf';
			arch_cmd = `${tar_bin} ${tar_args} "${arch_file}" .`;
		}
		else this.die('Unsupported archive format: ' + arch_file);
		
		if (args.dry) {
			this.s3.logDebug(9, "Dry-run, returning faux success");
			return;
		}
		
		this.s3.logDebug(9, "Taking snapshot of: " + args.remotePath);
		this.s3.logDebug(9, "Saving archive to: " + arch_file);
		
		// reroute download to temp dir
		args.localPath = Path.join( TEMP_DIR, 's3-temp-' + process.pid );
		
		// show progress if we have a tty
		if (cli.tty()) {
			cli.progress.start();
			args.progress = this.progressHandler;
		}
		
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
			let output = cp.execSync( arch_cmd + ' 2>&1', {
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
			let expire_at = Tools.timeNow(true) - Tools.getSecondsFromText(args.expire);
			this.s3.logDebug(9, "Expiring old snapshots in: " + base_dir + " (" + args.expire + ")");
			
			Tools.findFilesSync( base_dir, {
				recurse: false,
				filter: function(file, stats) {
					return (stats.mtimeMs / 1000) <= expire_at;
				}
			}).forEach( function(file) {
				self.s3.logDebug(5, "Deleting expired snapshot: " + file);
				fs.unlinkSync(file);
			} );
		}
		
		cli.progress.end();
		
		// and we're done
		println( "\n" + cyan.bold("Snapshot written to: ") + yellow.bold(arch_file) );
	},
	
	async cmd_snap() {
		// alias for snapshot
		cmd = this.cmd = 'snapshot';
		await this.cmd_snapshot();
	},
	
	async cmd_restoreSnapshot() {
		// expand local archive, upload files to s3
		// s3 restoreSnapshot /path/to/backup-2024-05-22.zip s3://my-bucket/s3dir/images
		// { remotePath, localFile, delete?, threads? }
		this.shiftOther('localFile') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'remotePath') || this.dieUsage(this.cmd);
		this.addMultiFilter();
		
		delete args.other;
		this.printArgSummary();
		
		let arch_file = args.localFile || this.dieUsage(this.cmd);
		delete args.localFile;
		
		// arch file needs to be absolute
		arch_file = Path.resolve(arch_file);
		
		if (args.dry) {
			this.s3.logDebug(9, "Dry-run, returning faux success");
			return;
		}
		
		this.s3.logDebug(9, "Opening snapshot: " + arch_file);
		this.s3.logDebug(9, "Restoring snapshot to: " + args.remotePath);
		
		// create temp dir
		let temp_dir = Path.join( TEMP_DIR, 's3-temp-' + process.pid );
		try {
			Tools.mkdirp.sync( temp_dir );
		}
		catch (err) {
			this.die(err);
		}
		
		// expand archive into temp dir
		let arch_cmd = '';
		if (arch_file.match(/\.zip$/i)) {
			let unzip_bin = Tools.findBinSync('unzip') || this.die('Cannot locate `unzip` binary.');
			arch_cmd = `${unzip_bin} "${arch_file}"`;
		}
		else if (arch_file.match(/\.tar(\.gz|\.xz|\.bz2)?$/i)) {
			let tar_bin = Tools.findBinSync('tar') || this.die('Cannot locate `tar` binary.');
			arch_cmd = `${tar_bin} -xvf "${arch_file}"`;
		}
		else this.die('Unsupported archive format: ' + arch_file);
		
		// show progress if we have a tty
		if (cli.tty()) {
			cli.progress.start();
		}
		
		// do the expansion
		try {
			this.s3.logDebug(9, "Expanding archive", arch_cmd);
			let output = cp.execSync( arch_cmd + ' 2>&1', {
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
		
		// show progress if we have a tty
		if (cli.tty()) {
			args.progress = this.progressHandler;
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
		
		cli.progress.end();
		
		println( "\n" + cyan.bold("Snapshot restored to: ") + yellow.bold('s3://' + args.bucket + '/' + args.remotePath) );
	},
	
	async cmd_rs() {
		// alias for restoreSnapshot
		cmd = this.cmd = 'restoreSnapshot';
		await this.cmd_restoreSnapshot();
	},
	
	async cmd_backup() {
		// backup local files to s3 as compressed archive
		// s3 backup /path/to/files s3://my-bucket/backups/mybackup-[yyyy]-[mm]-[dd].zip
		this.shiftOther('localPath') || this.dieUsage(this.cmd);
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		
		delete args.other;
		this.printArgSummary();
		
		let src_path = Path.resolve(args.localPath).replace(/\/$/, '');
		delete args.localPath;
		
		// determine the "true" base dir, outside of any macros
		let base_path = Path.dirname(args.key);	
		while (base_path.match(/\[/)) { base_path = Path.dirname(base_path); }
		
		// allow s3 key to have date/time placeholders, e.g. `my-backup-[yyyy]-[mm]-[dd].zip`
		args.key = Tools.formatDate( Tools.timeNow(), args.key );
		
		let arch_file = Path.join( TEMP_DIR, 's3-temp-' + process.pid );
		let arch_cmd = '';
		
		if (args.key.match(/(\.zip)$/i)) {
			arch_file += RegExp.$1;
			let zip_bin = Tools.findBinSync('zip') || this.die('Cannot locate `zip` binary.');
			let zip_args = args.zipArgs || '-r';
			arch_cmd = `${zip_bin} ${zip_args} "${arch_file}" .`;
		}
		else if (args.key.match(/(\.tar|\.tar\.gz|\.tar\.xz|\.tar\.bz2)$/i)) {
			arch_file += RegExp.$1;
			let tar_bin = Tools.findBinSync('tar') || this.die('Cannot locate `tar` binary.');
			let tar_args = args.tarArgs || '-acvf';
			arch_cmd = `${tar_bin} ${tar_args} "${arch_file}" .`;
		}
		else this.die('Unsupported archive format: ' + args.key);
		
		if (args.dry) {
			this.s3.logDebug(9, "Dry-run, returning faux success");
			return;
		}
		
		this.s3.logDebug(9, "Making backup of: " + src_path);
		this.s3.logDebug(9, "Target archive location: " + args.key);
		
		// show progress if we have a tty
		if (cli.tty()) {
			cli.progress.start();
			args.progress = this.progressHandler;
		}
		
		// zip the local dir
		try {
			this.s3.logDebug(9, "Compressing archive", arch_cmd);
			let output = cp.execSync( arch_cmd + ' 2>&1', {
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
			args.remotePath = base_path + '/';
			delete args.value;
			delete args.progress;
			
			this.s3.logDebug(9, "Expiring old backups in: " + base_path + " (" + args.expire + ")");
			
			try {
				await this.s3.deleteFiles(args);
			}
			catch (err) {
				this.die(err);
			}
		}
		
		cli.progress.end();
		
		// and we're done
		println( "\n" + cyan.bold("Backup saved to: ") + yellow.bold('s3://' + args.bucket + '/' + args.key) );
	},
	
	async cmd_bk() {
		// alias for backup
		cmd = this.cmd = 'backup';
		await this.cmd_backup();
	},
	
	async cmd_restoreBackup() {
		// download and restore backup to local filesystem
		// s3 restoreBackup s3://my-bucket/backups/mybackup-2024-05-22.zip /path/to/files
		this.shiftS3Spec('bucket', 'key') || this.dieUsage(this.cmd);
		this.shiftOther('localPath') || this.dieUsage(this.cmd);
		
		delete args.other;
		this.printArgSummary();
		
		let dest_path = Path.resolve(args.localPath).replace(/\/$/, '');
		delete args.localPath;
		
		let arch_file = Path.join( TEMP_DIR, 's3-temp-' + process.pid );
		let arch_cmd = '';
		
		if (args.key.match(/\.zip$/i)) {
			let unzip_bin = Tools.findBinSync('unzip') || this.die('Cannot locate `unzip` binary.');
			arch_file += '.zip';
			arch_cmd = `${unzip_bin} -o "${arch_file}"`;
		}
		else if (args.key.match(/(\.tar|\.tar\.gz|\.tar\.xz|\.tar\.bz2)$/i)) {
			arch_file += RegExp.$1;
			let tar_bin = Tools.findBinSync('tar') || this.die('Cannot locate `tar` binary.');
			arch_cmd = `${tar_bin} -xvf "${arch_file}"`;
		}
		else this.die('Unsupported archive format: ' + args.key);
		
		if (args.dry) {
			this.s3.logDebug(9, "Dry-run, returning faux success");
			return;
		}
		
		this.s3.logDebug(9, "Opening backup: " + args.key);
		this.s3.logDebug(9, "Restoring backup to: " + dest_path);
		
		// show progress if we have a tty
		if (cli.tty()) {
			cli.progress.start();
			args.progress = this.progressHandler;
		}
		
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
			let output = cp.execSync( arch_cmd + ' 2>&1', {
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
		
		cli.progress.end();
		
		// and we're done
		println( "\n" + cyan.bold("Backup restored to: ") + yellow.bold(dest_path) );
	},
	
	async cmd_rb() {
		// alias for restoreBackup
		cmd = this.cmd = 'restoreBackup';
		await this.cmd_restoreBackup();
	}
	
}; // app

app.run();
