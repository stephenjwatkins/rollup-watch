import EventEmitter from 'events';
import * as fs from 'fs';
import { exec } from 'child_process';
import { gt } from 'semver';

function sequence ( array, fn ) {
	var results = [];
	var promise = Promise.resolve();

	function next ( member, i ) {
		return fn( member ).then( function (value) { return results[i] = value; } );
	}

	var loop = function ( i ) {
		promise = promise.then( function () { return next( array[i], i ); } );
	};

	for ( var i = 0; i < array.length; i += 1 ) loop( i );

	return promise.then( function () { return results; } );
}

function assign ( target ) {
	var sources = [], len = arguments.length - 1;
	while ( len-- > 0 ) sources[ len ] = arguments[ len + 1 ];

	sources.forEach( function (source) {
		for ( var key in source ) {
			if ( source.hasOwnProperty( key ) ) target[ key ] = source[ key ];
		}
	});

	return target;
}

var name = "rollup-watch";
var version = "2.5.0";

function checkVersion ( name, localVersion ) {
	return new Promise( function ( fulfil, reject ) {
		exec( ("npm show " + name + " version"), function ( err, result ) {
			if ( err ) return reject( err );
			fulfil( result.trim() );
		});
	}).then( function (latestVersion) {
		if ( gt( latestVersion, localVersion ) ) {
			var err = new Error( (name + " is out of date") );
			err.code = 'OUT_OF_DATE';
			err.localVersion = localVersion;
			err.latestVersion = latestVersion;
		}
	});
}

var opts = { encoding: 'utf-8', persistent: true };

var FileWatcher = function FileWatcher ( file, data, callback, dispose ) {
	try {
		var fsWatcher = fs.watch( file, opts, function (event) {
			if ( event === 'rename' ) {
				fsWatcher.close();
				dispose();
				callback();
			} else {
				// this is necessary because we get duplicate events...
				var contents = fs.readFileSync( file, 'utf-8' );
				if ( contents !== data ) {
					data = contents;
					callback();
				}
			}
		});

		this.fileExists = true;
	} catch ( err ) {
		if ( err.code === 'ENOENT' ) {
			// can't watch files that don't exist (e.g. injected
			// by plugins somehow)
			this.fileExists = false;
		} else {
			throw err;
		}
	}
};

function watch ( rollup, options ) {
	var emitter = new EventEmitter();

	process.nextTick( function () { return emitter.emit( 'event', { code: 'STARTING' }); } );

	checkVersion( name, version )
		.catch( function (err) {
			if ( err.code === 'OUT_OF_DATE' ) {
				// TODO offer to update
				console.error( ("rollup-watch is out of date (you have " + (err.localVersion) + ", latest version is " + (err.latestVersion) + "). Update it with npm install -g rollup-watch") ); // eslint-disable-line no-console
			}
		})
		.then( function () {
			var filewatchers = new Map();

			var rebuildScheduled = false;
			var building = false;
			var watching = false;

			var timeout;
			var cache;

			function triggerRebuild () {
				clearTimeout( timeout );
				rebuildScheduled = true;

				timeout = setTimeout( function () {
					if ( !building ) {
						rebuildScheduled = false;
						build();
					}
				}, 50 );
			}

			function build () {
				if ( building ) return;

				var start = Date.now();
				var initial = !watching;
				var opts = assign( {}, options, cache ? { cache: cache } : {});

				delete opts.buildSelf;

				emitter.emit( 'event', { code: 'BUILD_START' });

				building = true;

				return rollup.rollup( opts )
					.then( function (bundle) {
						// Save off bundle for re-use later
						cache = bundle;

						bundle.modules.forEach( function (module) {
							var id = module.id;

							// skip plugin helper modules
							if ( /\0/.test( id ) ) return;

							if ( !filewatchers.has( id ) ) {
								var watcher = new FileWatcher( id, module.originalCode, triggerRebuild, function () {
									filewatchers.delete( id );
								});

								if ( watcher.fileExists ) filewatchers.set( id, watcher );
							}
						});

						if ( options.buildSelf ) {
							return new Promise(function (resolve) {
								emitter.emit( 'event', {
									code: 'BUILD_SELF',
									bundle: bundle,
									done: resolve
								});
							});
						}

						if ( options.targets ) {
							return sequence( options.targets, function (target) {
								var mergedOptions = Object.assign( {}, options, target );
								return bundle.write( mergedOptions );
							});
						}

						return bundle.write( options );
					})
					.then( function () {
						emitter.emit( 'event', {
							code: 'BUILD_END',
							duration: Date.now() - start,
							initial: initial
						});
					}, function (error) {
						emitter.emit( 'event', {
							code: 'ERROR',
							error: error
						});
					})
					.then( function () {
						building = false;
						if ( rebuildScheduled ) build();
					});
			}

			build();
		});

	return emitter;
}

export default watch;