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

async function performMerge(
	bigFilePath: string,
	cacheFilePath: string,
	tmpFilePath: string,
) {
	try {
		const writeStream = fs.createWriteStream(bigFilePath, {
			flags: 'a',
		});
		const readStream = fs.createReadStream(tmpFilePath);
		await new Promise((resolve, reject) => {
			readStream.pipe(writeStream);
			readStream.on('end', resolve);
			readStream.on('error', reject);
		});
	} catch (e) {
		// Something went wrong, restore the old file and anything
		// that happened inbetween
		await fs.writeFile(
			cacheFilePath,
			(await fs.readFile(tmpFilePath, 'utf-8')) +
				(await fs.readFile(cacheFilePath, 'utf-8')),
			'utf-8',
		);
		throw e;
	} finally {
		// Delete the tmp file
		await fs.unlink(tmpFilePath);
	}
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
				}),
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
	for (const [cacheFilePath, bigFilePath] of Object.entries(files)) {
		const stat = await fs.stat(cacheFilePath);
		if (stat.size < maxSize) {
			console.log(
				`File "${cacheFilePath}" is only ${prettyBytes(
					stat.size,
				)} / ${prettyBytes(maxSize)}, skipping merge`,
			);
			continue;
		}
		console.log(
			`Appending ${prettyBytes(
				stat.size,
			)} bytes of data from "${cacheFilePath}" to "${bigFilePath}...`,
		);

		// We ensure no data is lost in this process. We do this by moving the file first
		// and replacing it with an empty file. Then we copy the data, then we remove the
		// old file. If anything went wrong inbetween, we can just restore the old file.
		const tmpFilePath = `${cacheFilePath}.tmp`;
		await fs.rename(cacheFilePath, tmpFilePath);
		await fs.writeFile(cacheFilePath, '', 'utf-8');

		const beforeExitHook = () => {
			// Quickly restore. This is not the best way to do this but the fastest
			fs.rename(tmpFilePath, cacheFilePath);
		};
		process.on('beforeExit', beforeExitHook);

		// Do the merging
		try {
			await performMerge(bigFilePath, cacheFilePath, tmpFilePath);
		} catch (e) {
			console.error('Error during merge:', e);
		} finally {
			process.off('beforeExit', beforeExitHook);
		}

		const bigFileStat = await fs.stat(bigFilePath);
		console.log(
			`Appended ${prettyBytes(
				stat.size,
			)} bytes of data from "${cacheFilePath}" to "${bigFilePath}, bringing it to a total of ${prettyBytes(
				bigFileStat.size,
			)}`,
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
