import filesizeParser from 'filesize-parser';
import prettyBytes from 'pretty-bytes';
import * as fs from 'fs-extra';

const DEFAULT_INTERVAL_SECONDS = 60 * 60 * 24;
const DEFAULT_MAX_SIZE = '1gb';

interface FileMap {
	[bufferFile: string]: string;
}

interface IO {
	files: FileMap;
	interval: number;
	maxSize: number;
}

async function getFiles() {
	let files: FileMap = {};
	let interval: number = DEFAULT_INTERVAL_SECONDS;
	let maxSize: number = filesizeParser(DEFAULT_MAX_SIZE);
	for (let i = 2; i < process.argv.length; i++) {
		const arg = process.argv[i];
		if (arg === '--config') {
			files = JSON.parse(
				await fs.readFile(process.argv[i + 1], {
					encoding: 'utf8',
				})
			);
			i++;
		} else if (arg === '--interval') {
			interval = parseInt(process.argv[i + 1]);
			i++;
		} else if (arg === '--max-size') {
			maxSize = filesizeParser(process.argv[i + 1]);
			i++;
		} else {
			console.error(`Unknown argument "${arg}"`);
			process.exit(1);
		}
	}

	if (Object.keys(files).length === 0) {
		console.error(`No files passed, please supply a --config argument`);
		process.exit(1);
	}

	return {
		files,
		interval,
		maxSize,
	};
}

async function mergeBigFiles(files: FileMap, maxSize: number) {
	for (const [cacheFile, bigFile] of Object.entries(files)) {
		const stat = await fs.stat(cacheFile);
		if (stat.size < maxSize) {
			console.log(
				`File "${cacheFile}" is only ${prettyBytes(
					stat.size
				)} / ${prettyBytes(maxSize)}, skipping merge`
			);
			continue;
		}
		console.log(
			`Appending ${prettyBytes(
				stat.size
			)} bytes of data from "${cacheFile}" to "${bigFile}...`
		);

		// We ensure no data is lost in this process. We do this by moving the file first
		// and replacing it with an empty file. Then we copy the data, then we remove the
		// old file. If anything went wrong inbetween, we can just restore the old file.
		const tmpFileLocation = `${cacheFile}.tmp`;
		await fs.rename(cacheFile, tmpFileLocation);
		await fs.writeFile(cacheFile, '', 'utf-8');

		process.on('beforeExit', () => {
			// Quickly restore. This is not the best way to do this but the fastest
			fs.rename(tmpFileLocation, cacheFile);
		});

		// Do the merging
		try {
			const writeStream = fs.createWriteStream(bigFile, {
				flags: 'a',
			});
			const readStream = fs.createReadStream(tmpFileLocation);
			await new Promise((resolve, reject) => {
				readStream.pipe(writeStream);
				readStream.on('end', resolve);
				readStream.on('error', reject);
			});
		} catch (e) {
			// Something went wrong, restore the old file and anything
			// that happened inbetween
			await fs.writeFile(
				cacheFile,
				(await fs.readFile(tmpFileLocation, 'utf-8')) +
					(await fs.readFile(cacheFile, 'utf-8')),
				'utf-8'
			);
		} finally {
			// Delete the tmp file
			await fs.unlink(tmpFileLocation);
		}

		const bigFileStat = await fs.stat(bigFile);
		console.log(
			`Appended ${prettyBytes(
				stat.size
			)} bytes of data from "${cacheFile}" to "${bigFile}, bringing it to a total of ${prettyBytes(
				bigFileStat.size
			)}`
		);
	}
}

async function startWatcher(io: IO) {
	console.log('Doing initial merge');
	await mergeBigFiles(io.files, io.maxSize);
	console.log('Setting timer');
	setInterval(async () => {
		await mergeBigFiles(io.files, io.maxSize);
	}, io.interval * 1000);
	console.log('All set up!');
}

async function main() {
	console.log('Starting...');
	const io = await getFiles();
	console.log('Files=', io.files);
	await startWatcher(io);
}

void (async () => {
	await main();
})();
