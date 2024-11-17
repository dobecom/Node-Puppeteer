## Node-Puppeteer
This repository contains a web crawler reference built with Node.js and Puppeteer. The crawler navigates through web pages, extracts several information, and saves it in a CSV format with UTF-8 encoding for further analysis.

### Features

- **Crawls web pages** from specified web pages.
- **Extracts detailed information** including:
  - Company name
  - Job position
  - Tech details (first 100 characters)
  - Location
  - Founded year
  - Company features
  - Average salary
  - Turnover/entry rates
- **Handles dynamic rendering** by waiting for specific elements to load.
- **Automatic scrolling** for infinite scroll pages to ensure all data is loaded.
- **Memory optimization** to manage browser resources effectively.
- **Saves data** in CSV format with UTF-8 BOM for proper character display.

### Usage

Run the crawler using:
```bash
node index.js
```

The extracted data will be saved as a CSV file in the `exports` directory with the current timestamp.

## Configuration

- **Timeout handling**: Configured to handle navigation timeouts and save partial data in case of errors.
- **Dynamic content loading**: Uses mutation observers to wait for dynamic content to fully render before extraction.
- **Memory management**: Automatically closes unused browser pages to optimize memory usage.

## Dependencies

- `puppeteer-core`: For browser automation.
- `csv-stringify`: For generating CSV output.
- `dotenv`: For loading environment variables.