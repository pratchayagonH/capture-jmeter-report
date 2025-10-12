#!/usr/bin/env node

/**
 * Cross-platform JMeter report capture script
 * Works on Windows, Mac, and Linux
 */

const { Command } = require('commander');
const fs = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const { chromium } = require('playwright');

class JMeterReportAnalyzer {
    constructor(searchLocation, outputPath, selectionMode = 'b', threshold = 1000) {
        this.searchLocation = searchLocation;
        this.outputPath = outputPath;
        this.selectionMode = selectionMode;
        this.threshold = threshold;
        this.foldersData = {};
    }

    /**
     * Find all folders that contain the specified folder name
     */
    async findMatchingFolders(folderName) {
        const matchingFolders = [];
        
        try {
            // Use glob to find directories containing the folder name
            // Use forward slashes for glob patterns (works on all platforms)
            const pattern = path.join(this.searchLocation, '**', `*${folderName}*`).replace(/\\/g, '/');
            console.log(`Searching for folders matching: ${pattern} and Folder Name: ${folderName}`);
            const items = await glob(pattern, { onlyDirectories: true });
            
            for (const item of items) {
                if (path.basename(item).includes(folderName)) {
                    matchingFolders.push(item);
                }
            }
        } catch (error) {
            console.error(`Error searching for folders: ${error.message}`);
        }
        
        return matchingFolders;
    }

    /**
     * Extract numeric value from text, handling various formats
     */
    extractNumber(text) {
        // Remove commas and other non-numeric characters except decimal point
        const cleaned = String(text).replace(/[^\d.-]/g, '');
        const number = parseFloat(cleaned);
        return isNaN(number) ? 0.0 : number;
    }

    /**
     * Parse the statisticsTable from JMeter HTML report
     */
    async parseStatisticsTable(htmlFilePath) {
        try {
            const folderPath = path.dirname(htmlFilePath);
            const dashboardJsPath = path.join(folderPath, 'content', 'js', 'dashboard.js');
            
            let content = '';
            
            if (await fs.pathExists(dashboardJsPath)) {
                content = await fs.readFile(dashboardJsPath, 'utf-8');
            } else {
                // Fallback to HTML file
                content = await fs.readFile(htmlFilePath, 'utf-8');
            }
            
            // Look for the statisticsTable data in JavaScript
            const statsPattern = /createTable\(\$\("#statisticsTable"\),\s*({.*?}),\s*function/s;
            const match = content.match(statsPattern);
            
            if (!match) {
                console.warn(`Warning: No statisticsTable data found in ${htmlFilePath}`);
                return {};
            }
            
            // Extract the JSON data
            let statsJsonStr = match[1];
            
            // Clean up the JSON (remove JavaScript trailing commas, etc.)
            statsJsonStr = statsJsonStr.replace(/,\s*}/g, '}');
            statsJsonStr = statsJsonStr.replace(/,\s*]/g, ']');
            
            let statsData;
            try {
                statsData = JSON.parse(statsJsonStr);
            } catch (jsonError) {
                console.error(`Error parsing JSON from ${htmlFilePath}: ${jsonError.message}`);
                // Try a more lenient approach using eval (dangerous but needed for malformed JSON)
                try {
                    statsData = eval(`(${statsJsonStr})`);
                } catch (evalError) {
                    console.error(`Error evaluating data from ${htmlFilePath}: ${evalError.message}`);
                    return {};
                }
            }
            
            const rowsData = {};
            
            // Extract column titles to understand data structure
            const titles = statsData.titles || [];
            
            // Find indices for the columns we need
            const labelIdx = titles.findIndex(title => title === 'Label');
            const minIdx = titles.findIndex(title => title === 'Min');
            const maxIdx = titles.findIndex(title => title === 'Max');
            const pct95Idx = titles.findIndex(title => title === '95th pct');
            
            // Use fallback indices if not found
            const actualLabelIdx = labelIdx !== -1 ? labelIdx : 0;
            const actualMinIdx = minIdx !== -1 ? minIdx : 5;
            const actualMaxIdx = maxIdx !== -1 ? maxIdx : 6;
            const actualPct95Idx = pct95Idx !== -1 ? pct95Idx : 8;
            
            // Process each item (row)
            const items = statsData.items || [];
            for (const item of items) {
                const dataRow = item.data || [];
                const maxColIdx = Math.max(actualLabelIdx, actualMinIdx, actualMaxIdx, actualPct95Idx);
                
                if (dataRow.length > maxColIdx) {
                    const label = dataRow[actualLabelIdx];
                    const minTime = this.extractNumber(dataRow[actualMinIdx]);
                    const maxTime = this.extractNumber(dataRow[actualMaxIdx]);
                    const pct95 = this.extractNumber(dataRow[actualPct95Idx]);
                    
                    rowsData[label] = {
                        min: minTime,
                        max: maxTime,
                        '95th_pct': pct95
                    };
                }
            }
            
            // Also include the overall row if present
            const overall = statsData.overall || {};
            if (overall.data) {
                const overallData = overall.data;
                const maxOverallIdx = Math.max(actualLabelIdx, actualMinIdx, actualMaxIdx, actualPct95Idx);
                
                if (overallData.length > maxOverallIdx) {
                    const label = overallData[actualLabelIdx];
                    const minTime = this.extractNumber(overallData[actualMinIdx]);
                    const maxTime = this.extractNumber(overallData[actualMaxIdx]);
                    const pct95 = this.extractNumber(overallData[actualPct95Idx]);
                    
                    rowsData[label] = {
                        min: minTime,
                        max: maxTime,
                        '95th_pct': pct95
                    };
                }
            }
            
            return rowsData;
            
        } catch (error) {
            console.error(`Error parsing ${htmlFilePath}: ${error.message}`);
            return {};
        }
    }

    /**
     * Analyze all matching folders and extract statistics
     */
    async analyzeFolders(folderName) {
        const matchingFolders = await this.findMatchingFolders(folderName);
        
        if (matchingFolders.length === 0) {
            console.error(`No folders found containing '${folderName}' in ${this.searchLocation}`);
            process.exit(1);
        }
        
        console.log(`Found ${matchingFolders.length} matching folders`);
        
        for (const folderPath of matchingFolders) {
            // Look for index.html in the folder
            const indexFile = path.join(folderPath, 'index.html');
            
            if (!(await fs.pathExists(indexFile))) {
                console.warn(`Warning: index.html not found in ${folderPath}`);
                continue;
            }
            
            const stats = await this.parseStatisticsTable(indexFile);
            if (Object.keys(stats).length > 0) {
                this.foldersData[folderPath] = stats;
                console.log(`Processed ${Object.keys(stats).length} rows from ${folderPath}`);
            }
        }
    }

    /**
     * Select folder with lowest overall 95th percentile
     */
    selectBestFolder() {
        let bestFolder = null;
        let bestScore = Infinity;
        
        for (const [folderPath, stats] of Object.entries(this.foldersData)) {
            // Calculate average 95th percentile for this folder
            const pct95Values = Object.values(stats).map(data => data['95th_pct']);
            const avgPct95 = pct95Values.length > 0 ? 
                pct95Values.reduce((a, b) => a + b, 0) / pct95Values.length : Infinity;
            
            if (avgPct95 < bestScore) {
                bestScore = avgPct95;
                bestFolder = folderPath;
            }
        }
        
        return [bestFolder, this.foldersData[bestFolder] || {}];
    }

    /**
     * Select folder with highest overall 95th percentile
     */
    selectWorstFolder() {
        let worstFolder = null;
        let worstScore = 0;
        
        for (const [folderPath, stats] of Object.entries(this.foldersData)) {
            // Calculate average 95th percentile for this folder
            const pct95Values = Object.values(stats).map(data => data['95th_pct']);
            const avgPct95 = pct95Values.length > 0 ? 
                pct95Values.reduce((a, b) => a + b, 0) / pct95Values.length : 0;
            
            if (avgPct95 > worstScore) {
                worstScore = avgPct95;
                worstFolder = folderPath;
            }
        }
        
        return [worstFolder, this.foldersData[worstFolder] || {}];
    }

    /**
     * For each row label, select the best 95th percentile across all folders
     */
    selectBestIndividual() {
        const allLabels = new Set();
        for (const stats of Object.values(this.foldersData)) {
            Object.keys(stats).forEach(label => allLabels.add(label));
        }
        
        const bestIndividual = {};
        
        for (const label of allLabels) {
            let bestValue = Infinity;
            let bestData = null;
            
            for (const [folderPath, stats] of Object.entries(this.foldersData)) {
                if (stats[label] && stats[label]['95th_pct'] < bestValue) {
                    bestValue = stats[label]['95th_pct'];
                    bestData = { ...stats[label] };
                    bestData.source_folder = folderPath;
                }
            }
            
            if (bestData) {
                bestIndividual[label] = bestData;
            }
        }
        
        return bestIndividual;
    }

    /**
     * For each row label, select the worst 95th percentile across all folders
     */
    selectWorstIndividual() {
        const allLabels = new Set();
        for (const stats of Object.values(this.foldersData)) {
            Object.keys(stats).forEach(label => allLabels.add(label));
        }
        
        const worstIndividual = {};
        
        for (const label of allLabels) {
            let worstValue = 0;
            let worstData = null;
            
            for (const [folderPath, stats] of Object.entries(this.foldersData)) {
                if (stats[label] && stats[label]['95th_pct'] > worstValue) {
                    worstValue = stats[label]['95th_pct'];
                    worstData = { ...stats[label] };
                    worstData.source_folder = folderPath;
                }
            }
            
            if (worstData) {
                worstIndividual[label] = worstData;
            }
        }
        
        return worstIndividual;
    }

    /**
     * Generate individual HTML file for a row
     */
    async generateHtmlFile(label, data, folderName, outputDir) {
        const minTime = data.min;
        const maxTime = data.max;
        const pct95 = data['95th_pct'];
        
        // Determine status and color
        let statusColor, statusText;
        if (pct95 > this.threshold) {
            statusColor = "#bd0404";
            statusText = "Fail";
        } else {
            statusColor = "#36B37E";
            statusText = "Passed";
        }
        
        const htmlContent = `<html lang="en"><head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Report</title>
</head>
<body>
  <div id="root">
    <div>ID: </div>
    <div>Performance Test Status: <span style="color:${statusColor}">${statusText}</span></div>
    <div>API Path: </div>
    <div>Usage: Mobile</div>
    <div>Changed: N/A</div>
    <div>Min / Max Response Time: ${minTime} ms / ${maxTime} ms</div>
    <div>Response Time at 95 percentile Under 1 TPS: ${pct95} ms</div>
    <div>Limitation: N/A</div>
    <div>${folderName}</div>
  </div>
</body></html>`;
        
        // Save HTML file
        const safeLabel = label.replace(/[^\w\-_.]/g, '_'); // Make filename safe
        const htmlFilePath = path.join(outputDir, `${safeLabel}.html`);
        
        await fs.writeFile(htmlFilePath, htmlContent, 'utf-8');
        console.log(`Generated: ${htmlFilePath}`);
    }

    /**
     * Capture screenshot of statisticsTable with highlighted row
     */
    async captureScreenshot(sourceFolder, label, outputDir) {
        const indexFile = path.join(sourceFolder, 'index.html');
        
        if (!(await fs.pathExists(indexFile))) {
            console.warn(`Warning: Cannot capture screenshot, index.html not found in ${sourceFolder}`);
            return;
        }
        
        try {
            const browser = await chromium.launch({ headless: true });
            const page = await browser.newPage();
            
            // Load the HTML file
            await page.goto(`file://${path.resolve(indexFile)}`);
            
            // Wait for the table to load
            await page.waitForSelector('#statisticsTable', { timeout: 10000 });
            
            // Add script to highlight the specific row
            await page.addScriptTag({
                content: `
                // Find and highlight the row containing the label
                const rows = document.querySelectorAll('#statisticsTable tr');
                rows.forEach(row => {
                    const firstCell = row.querySelector('td:first-child');
                    if (firstCell && firstCell.textContent.trim() === '${label}') {
                        row.style.border = '3px solid #bd0404';
                        row.style.backgroundColor = 'rgba(189, 4, 4, 0.1)';
                    }
                });
                `
            });
            
            // Take screenshot of the table
            const table = page.locator('#statisticsTable');
            const safeLabel = label.replace(/[^\w\-_.]/g, '_');
            const screenshotPath = path.join(outputDir, `${safeLabel}.png`);
            
            await table.screenshot({ path: screenshotPath });
            await browser.close();
            
            console.log(`Screenshot saved: ${screenshotPath}`);
            
        } catch (error) {
            console.error(`Error capturing screenshot for ${label}: ${error.message}`);
        }
    }

    /**
     * Main execution method
     */
    async run(folderName) {
        console.log('Starting JMeter report analysis...');
        console.log(`Search location: ${this.searchLocation}`);
        console.log(`Folder name pattern: ${folderName}`);
        console.log(`Selection mode: ${this.selectionMode}`);
        console.log(`Threshold: ${this.threshold}ms`);
        
        // Analyze all matching folders
        await this.analyzeFolders(folderName);
        
        if (Object.keys(this.foldersData).length === 0) {
            console.error('No valid JMeter reports found!');
            process.exit(1);
        }
        
        // Create output directory
        const resultFolderName = `${folderName}_result`;
        const outputDir = path.join(this.outputPath, resultFolderName);
        
        // Remove existing directory if it exists
        if (await fs.pathExists(outputDir)) {
            await fs.remove(outputDir);
        }
        
        await fs.ensureDir(outputDir);
        console.log(`Output directory created: ${outputDir}`);
        
        // Select data based on mode
        let selectedData = {};
        let selectedFolder = null;
        
        if (this.selectionMode === 'b') {
            [selectedFolder, selectedData] = this.selectBestFolder();
            console.log(`Selected best folder: ${selectedFolder}`);
        } else if (this.selectionMode === 'w') {
            [selectedFolder, selectedData] = this.selectWorstFolder();
            console.log(`Selected worst folder: ${selectedFolder}`);
        } else if (this.selectionMode === 'bi') {
            selectedData = this.selectBestIndividual();
            console.log('Selected best individual values for each row');
        } else if (this.selectionMode === 'wi') {
            selectedData = this.selectWorstIndividual();
            console.log('Selected worst individual values for each row');
        }
        
        // Generate output files
        for (const [label, data] of Object.entries(selectedData)) {
            // Generate HTML file
            await this.generateHtmlFile(label, data, folderName, outputDir);
            
            // Determine source folder for screenshot
            let sourceFolder;
            if (['bi', 'wi'].includes(this.selectionMode)) {
                sourceFolder = data.source_folder || selectedFolder;
            } else {
                sourceFolder = selectedFolder;
            }
            
            // Capture screenshot
            if (sourceFolder) {
                await this.captureScreenshot(sourceFolder, label, outputDir);
            }
        }
        
        console.log(`\nAnalysis complete! Results saved to: ${outputDir}`);
        console.log(`Generated ${Object.keys(selectedData).length} HTML files and screenshots`);
    }
}

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
    
    // Parse the location argument to extract folder name and search location
    const locationArg = options.location.replace(/\/$/, ''); // Remove trailing slash if present
    const locationPath = path.resolve(locationArg);
    
    let folderName, searchLocation;
    console.log(locationPath)
    if (await fs.pathExists(locationPath) && (await fs.stat(locationPath)).isDirectory()) {
        // If the path exists and is a directory, use it as folder name and parent as search location
        folderName = path.basename(locationPath);
        searchLocation = path.dirname(locationPath);
    } else {
        // If path doesn't exist, assume it's search_location/folder_name format
        folderName = path.basename(locationPath);
        searchLocation = path.dirname(locationPath) || process.cwd();
    }
    
    // Create analyzer and run
    const analyzer = new JMeterReportAnalyzer(
        searchLocation,
        options.output,
        options.type,
        parseInt(options.threshold)
    );
    
    try {
        await analyzer.run(folderName);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Run the main function if this file is executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
}

module.exports = { JMeterReportAnalyzer };