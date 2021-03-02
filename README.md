# Big file cache

This program caches log outputs (and other big files that keep having data appended to them) in small files, before writing them to big files once in a while. The goal is to cache the ouput of a program in a cache file on a small-but-fast-and-quiet medium, after which it is periodically appended to a file on a large-but-slow-and-noisy medium periodically once it reaches some max size.

### Use case

The use case is me having a server in my house that hosts a lot of websites/services. Those programs generate a lot of logs, which are all written to disk. This disk is a large HDD which makes a lot of noise. This means that every few seconds there's a noise of the HDD being written to. This program fixes this by first writing logs to a small cache file on an SSD (which is of course very quiet), after which it is written to the HDD about once a day once it reaches a large enough size to begin to fill up the SSD.

## API

### Usage

```sh
node app/app.js --config myconfigfile.json --interval 10 --max-size 1gb
```

**Arguments:**

-   `--interval` (optional, default=1 day) Interval at which to run the check in seconds

-   `--max-size` (optional, default=1gb) The size after which the cache file is cleared and appended to the big file
-   `--config` (required) The path to a JSON config file of the following format

```json
{
	"/my/small/cache/file": "/big/log/file"
}
```
