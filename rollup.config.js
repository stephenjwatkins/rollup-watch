import buble from 'rollup-plugin-buble';
import json from 'rollup-plugin-json';

export default {
	entry: 'src/index.js',
	plugins: [ json(), buble() ],
	targets: [
		{ dest: 'dist/rollup-watch.cjs.js', format: 'cjs' },
		{ dest: 'dist/rollup-watch.es6.js', format: 'es6' }
	]
};
