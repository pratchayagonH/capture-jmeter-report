# JMeter Report Analyzer

A cross-platform Node.js tool for analyzing and capturing JMeter HTML performance test reports. This tool automatically finds JMeter report folders, extracts performance metrics, and generates HTML reports with screenshots based on various selection criteria.

## Features

- 🔍 **Auto-discovery**: Automatically finds JMeter report folders matching a pattern
- 📊 **Multiple Selection Modes**: Choose best/worst performance based on different criteria
- 📸 **Screenshot Capture**: Generates screenshots of statistics tables with highlighted rows
- 📝 **HTML Reports**: Creates individual HTML reports for each performance metric
- 🌐 **Cross-platform**: Works on Windows, macOS, and Linux
- ⚡ **Threshold-based**: Pass/Fail status based on configurable response time thresholds

## Prerequisites

- Node.js >= 16.0.0
- npm or yarn

## Installation

### Option 1: Using Node.js (Development)

```bash
# Clone or download the project
cd capture-jmeter-report

# Install dependencies
npm install

# Run directly
node src/index.js --help
```

### Option 2: Build Standalone Executables

Build platform-specific executables that don't require Node.js to be installed:

```bash
# Install dependencies
npm install

# Build for all platforms
npm run build:all

# Or build for specific platforms
npm run build:macos      # macOS (ARM64 & x64)
npm run build:windows    # Windows x64
npm run build:linux      # Linux x64

# Executables will be in the dist/ folder
```

## Usage

### Command Line Interface

```bash
node src/index.js -l <search-location> -o <output-path> [options]
```

### Programmatic Usage

```js
const { captureReport } = require('capture-jmeter-report');

async function run() {
  const summary = await captureReport({
    location: './968_verify_digital_email_1_R1',
    output: './results',
    type: 'b',
    threshold: 1200
  });

  console.log(summary.outputDir);
}

run().catch(console.error);
```

### Options

| Option | Description | Required | Default |
|--------|-------------|----------|---------|
| `-l, --location <path>` | Parent directory containing JMeter report folders | Yes | - |
| `-o, --output <path>` | Output directory for generated reports | Yes | - |
| `-t, --type <type>` | Selection mode: `b`, `w`, `bi`, `wi` | No | `b` |
| `-v, --threshold <ms>` | Response time threshold in milliseconds | No | `1000` |
| `-h, --help` | Display help information | No | - |
| `--version` | Display version number | No | - |

### Selection Modes

- **`b` (Best)**: Select the folder with the best overall performance (lowest average 95th percentile)
- **`w` (Worst)**: Select the folder with the worst overall performance (highest average 95th percentile)
- **`bi` (Best Individual)**: For each metric, select the best value across all folders
- **`wi` (Worst Individual)**: For each metric, select the worst value across all folders

## Examples

### Basic Usage

```bash
# Analyze reports and select the best performing folder
node src/index.js -l ./jmeter-reports -o ./results -t b

# Select worst performing folder with 2000ms threshold
node src/index.js -l ./jmeter-reports -o ./results -t w -v 2000

# Select best individual metrics across all folders
node src/index.js -l ./jmeter-reports -o ./results -t bi -v 1000
```

### Platform-Specific Examples

#### Windows (PowerShell)
```powershell
# Using the executable
.\dist\capture-jmeter-report-win.exe -l "D:\jmeter-reports" -o "D:\results" -t bi -v 1000

# Using Node.js
node src/index.js -l "C:\Reports\JMeter" -o "C:\Output" -t b
```

#### macOS
```bash
# Using the executable
./dist/capture-jmeter-report-macos -l ./jmeter-reports -o ./results -t bi

# Using Node.js
node src/index.js -l ~/Documents/jmeter-reports -o ~/Documents/results -t b
```

#### Linux
```bash
# Using the executable
./dist/capture-jmeter-report-linux -l /home/user/jmeter-reports -o /home/user/results -t bi

# Using Node.js
node src/index.js -l /var/reports/jmeter -o /var/reports/analysis -t w
```

### NPM Scripts

```bash
# Run with example data
npm run example-best              # Select best overall folder
npm run example-worst             # Select worst overall folder
npm run example-best-individual   # Select best individual metrics

# Show help
npm run help

# Run tests
npm test
```

## Expected Input Structure

The tool expects JMeter HTML reports with the following structure:

```
parent-directory/
├── test-run-1_R1/
│   ├── index.html
│   └── content/
│       └── js/
│           └── dashboard.js
├── test-run-1_R2/
│   ├── index.html
│   └── content/
│       └── js/
│           └── dashboard.js
└── test-run-1_R3/
    ├── index.html
    └── content/
        └── js/
            └── dashboard.js
```

When you run:
```bash
node src/index.js -l ./parent-directory/test-run-1_R1 -o ./output -t bi
```

The tool will:
1. Extract folder name pattern: `test-run-1_R1`
2. Search parent directory: `./parent-directory`
3. Find all folders matching: `*test-run-1*` (R1, R2, R3, etc.)
4. Analyze and compare all matching folders

## Output Structure

```
output-folder/
└── [folder-name]_result/
    ├── Transaction_Name_1.html
    ├── Transaction_Name_1.png
    ├── Transaction_Name_2.html
    ├── Transaction_Name_2.png
    └── ...
```

Each HTML file contains:
- Performance test status (Pass/Fail based on threshold)
- API path information
- Min/Max response times
- 95th percentile response time
- Source folder reference

Each PNG file shows:
- Screenshot of the JMeter statistics table
- Highlighted row for the specific transaction

## How It Works

1. **Discovery**: Searches for JMeter report folders matching the provided pattern
2. **Parsing**: Extracts performance metrics from `dashboard.js` or `index.html` files
3. **Analysis**: Compares metrics across all found folders based on selection mode
4. **Selection**: Selects best/worst metrics according to the chosen strategy
5. **Generation**: Creates HTML reports and captures screenshots for selected metrics

## Configuration

### Threshold

The threshold determines pass/fail status in generated reports:
- **Green (Passed)**: 95th percentile ≤ threshold
- **Red (Failed)**: 95th percentile > threshold

```bash
# Set 2000ms threshold
node src/index.js -l ./reports -o ./output -t b -v 2000
```

### Custom Integration

You can also use the tool programmatically:

```javascript
const { JMeterReportAnalyzer } = require('./src/index.js');

async function analyzeReports() {
    const analyzer = new JMeterReportAnalyzer(
        '/path/to/parent/directory',  // Search location
        './output',                    // Output path
        'bi',                          // Selection mode
        1000                           // Threshold in ms
    );
    
    await analyzer.run('report-folder-name');
}

analyzeReports();
```

## Troubleshooting

### "No folders found containing..."

**Problem**: The tool can't find your JMeter report folders.

**Solution**: 
- Ensure you're pointing to the **parent directory** that contains multiple report folders
- The folder name will be extracted from the path you provide
- Example: If you provide `-l ./reports/test-run-1_R1`, it will search `./reports` for folders matching `*test-run-1*`

### "Cannot find module 'commander'"

**Problem**: Dependencies are not installed.

**Solution**: 
```bash
npm install
```

### Screenshot capture fails

**Problem**: Playwright browser not installed.

**Solution**:
```bash
npx playwright install chromium
```

### Windows path issues

**Problem**: Paths with spaces or backslashes not recognized.

**Solution**: Use quotes around paths:
```powershell
node src/index.js -l "C:\Program Files\Reports" -o "C:\Output" -t b
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm start

# Build executables
npm run build:all

# Test the tool
npm test
```

## Dependencies

- **commander**: CLI argument parsing
- **fs-extra**: Enhanced file system operations
- **glob**: Pattern matching for file/folder discovery
- **playwright**: Browser automation for screenshot capture
- **cheerio**: HTML parsing (used for fallback parsing)
- **path**: Cross-platform path handling

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues, questions, or contributions, please open an issue on the project repository.

---

**Note**: This tool is designed to work with standard JMeter HTML Dashboard reports generated using the `-g` option or the `JMeterPluginsCMD.sh` reporter.
