#!/usr/bin/env node

const { Command } = require('commander');

const api = require('./lib');
const { captureReport } = api;

async function main() {
    const program = new Command();

    program
        .name('capture-jmeter-report')
        .description('JMeter Report Analyzer - Cross-platform script for analyzing JMeter HTML reports')
        .version('1.0.0')
        .requiredOption('-l, --location <path>', 'Search location folder path containing JMeter reports')
        .requiredOption('-o, --output <path>', 'Output path for results')
        .option('-t, --type <type>', 'Selection type: b=best, w=worst, bi=best-individual, wi=worst-individual', 'b')
        .option('-v, --threshold <number>', 'Threshold value in milliseconds', '1000');

    program.parse();

    const options = program.opts();

    try {
        const result = await captureReport({
            location: options.location,
            output: options.output,
            type: options.type,
            threshold: options.threshold
        });

        if (result && result.outputDir) {
            console.log(`\nCapture complete. Output written to ${result.outputDir}`);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

module.exports = api;

if (require.main === module) {
    main().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
}
