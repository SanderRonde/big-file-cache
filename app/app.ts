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
	await Promise.all(
		Object.entries(files).map(async ([cacheFile, bigFile]) => {
			const stat = await fs.stat(cacheFile);
			if (stat.size >= maxSize) {
				console.log(
					`Appending ${prettyBytes(
						stat.size
					)} bytes of data from "${cacheFile}" to "${bigFile}...`
				);

				// Do the merging
				const writeStream = fs.createWriteStream(bigFile, {
					flags: 'a',
				});
				const readStream = fs.createReadStream(cacheFile);

				await new Promise<void>((resolve, reject) => {
					readStream
						.pipe(writeStream)
						.on('close', async () => {
							// Clear the old file
							await fs.writeFile(cacheFile, '', {
								encoding: 'utf8',
							});
							resolve();
						})
						.on('error', reject);
				});

				const bigFileStat = await fs.stat(bigFile);
				console.log(
					`Appended ${prettyBytes(
						stat.size
					)} bytes of data from "${cacheFile}" to "${bigFile}, bringing it to a total of ${prettyBytes(
						bigFileStat.size
					)}`
				);
			}
		})
	);
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
	await startWatcher(io);
}

void (async () => {
	await main();
})();
