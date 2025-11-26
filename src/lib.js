const fs = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const { chromium } = require('playwright');

const SUPPORTED_SELECTION_MODES = new Set(['b', 'w', 'bi', 'wi']);

class JMeterReportAnalyzer {
    constructor(searchLocation, outputPath, selectionMode = 'b', threshold = 1000) {
        this.searchLocation = searchLocation;
        this.outputPath = outputPath;
        this.selectionMode = selectionMode;
        this.threshold = threshold;
        this.foldersData = {};
    }

    async findMatchingFolders(folderName) {
        const matchingFolders = [];

        try {
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

    extractNumber(text) {
        const cleaned = String(text).replace(/[^\d.-]/g, '');
        const number = parseFloat(cleaned);
        return isNaN(number) ? 0.0 : number;
    }

    async parseStatisticsTable(htmlFilePath) {
        try {
            const folderPath = path.dirname(htmlFilePath);
            const dashboardJsPath = path.join(folderPath, 'content', 'js', 'dashboard.js');

            let content = '';

            if (await fs.pathExists(dashboardJsPath)) {
                content = await fs.readFile(dashboardJsPath, 'utf-8');
            } else {
                content = await fs.readFile(htmlFilePath, 'utf-8');
            }

            const statsPattern = /createTable\(\$\("#statisticsTable"\),\s*({.*?}),\s*function/s;
            const match = content.match(statsPattern);

            if (!match) {
                console.warn(`Warning: No statisticsTable data found in ${htmlFilePath}`);
                return {};
            }

            let statsJsonStr = match[1];

            statsJsonStr = statsJsonStr.replace(/,\s*}/g, '}');
            statsJsonStr = statsJsonStr.replace(/,\s*]/g, ']');

            let statsData;
            try {
                statsData = JSON.parse(statsJsonStr);
            } catch (jsonError) {
                console.error(`Error parsing JSON from ${htmlFilePath}: ${jsonError.message}`);
                try {
                    statsData = eval(`(${statsJsonStr})`);
                } catch (evalError) {
                    console.error(`Error evaluating data from ${htmlFilePath}: ${evalError.message}`);
                    return {};
                }
            }

            const rowsData = {};

            const titles = statsData.titles || [];

            const labelIdx = titles.findIndex(title => title === 'Label');
            const minIdx = titles.findIndex(title => title === 'Min');
            const maxIdx = titles.findIndex(title => title === 'Max');
            const pct95Idx = titles.findIndex(title => title === '95th pct');

            const actualLabelIdx = labelIdx !== -1 ? labelIdx : 0;
            const actualMinIdx = minIdx !== -1 ? minIdx : 5;
            const actualMaxIdx = maxIdx !== -1 ? maxIdx : 6;
            const actualPct95Idx = pct95Idx !== -1 ? pct95Idx : 8;

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

    async analyzeFolders(folderName) {
        const matchingFolders = await this.findMatchingFolders(folderName);

        if (matchingFolders.length === 0) {
            const message = `No folders found containing '${folderName}' in ${this.searchLocation}`;
            console.error(message);
            throw new Error(message);
        }

        console.log(`Found ${matchingFolders.length} matching folders`);

        for (const folderPath of matchingFolders) {
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

    selectBestFolder() {
        let bestFolder = null;
        let bestScore = Infinity;

        for (const [folderPath, stats] of Object.entries(this.foldersData)) {
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

    selectWorstFolder() {
        let worstFolder = null;
        let worstScore = 0;

        for (const [folderPath, stats] of Object.entries(this.foldersData)) {
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

    async generateHtmlFile(label, data, folderName, outputDir) {
        const minTime = data.min;
        const maxTime = data.max;
        const pct95 = data['95th_pct'];

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

        const safeLabel = label.replace(/[^\w\-_.]/g, '_');
        const htmlFilePath = path.join(outputDir, `${safeLabel}.html`);

        await fs.writeFile(htmlFilePath, htmlContent, 'utf-8');
        console.log(`Generated: ${htmlFilePath}`);
        return htmlFilePath;
    }

    async captureScreenshot(sourceFolder, label, outputDir) {
        const indexFile = path.join(sourceFolder, 'index.html');

        if (!(await fs.pathExists(indexFile))) {
            console.warn(`Warning: Cannot capture screenshot, index.html not found in ${sourceFolder}`);
            return null;
        }

        try {
            const browser = await chromium.launch({ headless: true });
            const page = await browser.newPage();

            await page.goto(`file://${path.resolve(indexFile)}`);

            await page.waitForSelector('#statisticsTable', { timeout: 10000 });

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

            const table = page.locator('#statisticsTable');
            const safeLabel = label.replace(/[^\w\-_.]/g, '_');
            const screenshotPath = path.join(outputDir, `${safeLabel}.png`);

            await table.screenshot({ path: screenshotPath });
            await browser.close();

            console.log(`Screenshot saved: ${screenshotPath}`);
            return screenshotPath;
        } catch (error) {
            console.error(`Error capturing screenshot for ${label}: ${error.message}`);
            return null;
        }
    }

    async run(folderName) {
        console.log('Starting JMeter report analysis...');
        console.log(`Search location: ${this.searchLocation}`);
        console.log(`Folder name pattern: ${folderName}`);
        console.log(`Selection mode: ${this.selectionMode}`);
        console.log(`Threshold: ${this.threshold}ms`);

        await this.analyzeFolders(folderName);

        if (Object.keys(this.foldersData).length === 0) {
            const message = 'No valid JMeter reports found!';
            console.error(message);
            throw new Error(message);
        }

        const resultFolderName = `${folderName}_result`;
        const outputDir = path.join(this.outputPath, resultFolderName);

        if (await fs.pathExists(outputDir)) {
            await fs.remove(outputDir);
        }

        await fs.ensureDir(outputDir);
        console.log(`Output directory created: ${outputDir}`);

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

        const reportEntries = [];

        for (const [label, data] of Object.entries(selectedData)) {
            const htmlFilePath = await this.generateHtmlFile(label, data, folderName, outputDir);

            let sourceFolder;
            if (['bi', 'wi'].includes(this.selectionMode)) {
                sourceFolder = data.source_folder || selectedFolder;
            } else {
                sourceFolder = selectedFolder;
            }

            let screenshotPath = null;
            if (sourceFolder) {
                screenshotPath = await this.captureScreenshot(sourceFolder, label, outputDir);
            }

            reportEntries.push({
                label,
                data,
                htmlFilePath,
                screenshotPath,
                sourceFolder
            });
        }

        console.log(`\nAnalysis complete! Results saved to: ${outputDir}`);
        console.log(`Generated ${reportEntries.length} HTML files and screenshots`);

        return {
            outputDir,
            resultFolderName,
            selectedFolder,
            selectionMode: this.selectionMode,
            reports: reportEntries
        };
    }
}

async function resolveLocationOptions(locationInput) {
    if (!locationInput || typeof locationInput !== 'string') {
        throw new Error('A location path is required.');
    }

    const sanitized = locationInput.replace(/\/$/, '');
    const locationPath = path.resolve(sanitized);

    if (await fs.pathExists(locationPath) && (await fs.stat(locationPath)).isDirectory()) {
        return {
            folderName: path.basename(locationPath),
            searchLocation: path.dirname(locationPath),
            locationPath
        };
    }

    return {
        folderName: path.basename(locationPath),
        searchLocation: path.dirname(locationPath) || process.cwd(),
        locationPath
    };
}

async function captureReport(options = {}) {
    const { location, output, type = 'b', threshold = 1000 } = options;
    const selectionMode = String(type).toLowerCase();

    if (!location) {
        throw new Error('Option "location" is required.');
    }

    if (!output) {
        throw new Error('Option "output" is required.');
    }

    if (!SUPPORTED_SELECTION_MODES.has(selectionMode)) {
        throw new Error(`Invalid selection type "${type}". Supported values: ${Array.from(SUPPORTED_SELECTION_MODES).join(', ')}.`);
    }

    const thresholdValue = Number(threshold);
    if (!Number.isFinite(thresholdValue) || thresholdValue < 0) {
        throw new Error(`Invalid threshold value "${threshold}". Please provide a positive number.`);
    }

    const { folderName, searchLocation, locationPath } = await resolveLocationOptions(location);

    const analyzer = new JMeterReportAnalyzer(
        searchLocation,
        output,
        selectionMode,
        thresholdValue
    );

    const analysisResult = await analyzer.run(folderName);

    return Object.assign({}, analysisResult || {}, {
        folderName,
        searchLocation,
        locationPath,
        selectionMode,
        threshold: thresholdValue
    });
}

module.exports = {
    SUPPORTED_SELECTION_MODES,
    JMeterReportAnalyzer,
    captureReport,
    resolveLocationOptions
};
