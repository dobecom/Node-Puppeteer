import puppeteer from "puppeteer-core";
import { executablePath } from "puppeteer-core";
import fs from "fs";
import path from "path";
import { stringify } from "csv-stringify";
import dotenv from "dotenv";
dotenv.config();

// 직무 리스트 크롤링 함수
async function getJobList() {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: executablePath("chrome"),
  });

  const page = await browser.newPage();
  await page.goto(process.env.WEB_URL || "http://localhost:3000/home");
  const baseWebUrl = process.env.BASE_WEB_URL || "http://localhost:3000";
  let jobList = [];
  let companyDetailsList = []; // 회사 정보 중복 체크 리스트

  try {
    // 무한 스크롤 탐색하여 모든 직무 데이터 로드
    await autoScroll(page);
    await page.waitForSelector('ul[data-cy="job-list"] li.Card_Card__WdaEk');
    jobList = await page.$$eval(
      'ul[data-cy="job-list"] li.Card_Card__WdaEk',
      (jobs, baseUrl) =>
        jobs.map((job) => ({
          company:
            job
              .querySelector('div[data-cy="job-card"] a')
              .getAttribute("data-company-name") || "N/A",
          position:
            job
              .querySelector('div[data-cy="job-card"] a')
              .getAttribute("data-position-name") || "N/A",
          url:
            baseUrl +
            job.querySelector('div[data-cy="job-card"] a').getAttribute("href"),
        })),
      baseWebUrl // $$eval 함수의 두 번째 인자로 전달
    );

    for (const job of jobList) {
      try {
        await extractDetails(page, job, companyDetailsList);
      } catch (error) {
        if (error.name === "TimeoutError") {
          console.error(`Timeout error for ${job.url}: ${error.message}`);
          break; // 타임아웃 발생 시 루프 중지
        } else {
          console.error(
            `Error during details extraction for ${job.url}:`,
            error
          );
        }
      }
    }

    saveDataToFile(jobList);
  } catch (error) {
    console.error("Error during job list extraction:", error);
    saveDataToFile(jobList); // 다른 오류 발생 시에도 저장
  } finally {
    await browser.close();
  }
}

// 자동 스크롤 함수
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

// 회사 상세 페이지에서 설립 연도, 특징, 평균연봉, 퇴사/입사 정보 추출 (HTML 구조 기반 접근)
async function getCompanyDetails(page) {
  let foundedYear = "N/A";
  let features = "N/A";
  let averageSalary = "N/A";
  let turnoverEntry = "N/A";

  try {
    await page.waitForSelector(
      '[class*="CompanyInfo_CompanyInfo__FoundedYearWrapper"] time',
      { timeout: 30000 }
    );
    foundedYear = await page.evaluate(() => {
      const foundedYearWrapper = document.querySelector(
        '[class*="CompanyInfo_CompanyInfo__FoundedYearWrapper"]'
      );
      if (foundedYearWrapper) {
        const timeElement = foundedYearWrapper.querySelector("time");
        if (timeElement) {
          return timeElement.getAttribute("datetime") || "N/A";
        }
      }
      return "N/A";
    });

    await page.waitForSelector('[class*="CompanyTagList_CompanyTagList"]', {
      timeout: 30000,
    });
    features = await page.evaluate(() => {
      const featureContainer = document.querySelector(
        '[class*="CompanyTagList_CompanyTagList"]'
      );
      if (featureContainer) {
        const featureElements =
          featureContainer.querySelectorAll("div, button");
        return (
          Array.from(featureElements)
            .map((el) => el.innerText.trim())
            .filter(Boolean) // 빈 요소 필터링
            .join(" / ") || "N/A"
        );
      }
      return "N/A";
    });

    await page.waitForSelector('[class*="CompanyInfoTable_wrapper"]', {
      timeout: 30000,
    });
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        const observer = new MutationObserver((mutations, observerInstance) => {
          if (document.querySelector('[class*="CompanyInfoTable_wrapper"]')) {
            observerInstance.disconnect(); // 관찰 중지
            resolve();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    });

    [averageSalary, turnoverEntry] = await page.evaluate(() => {
      const detailsElements = Array.from(
        document.querySelectorAll('[class*="CompanyInfoTable_definition__dd"]')
      );

      const averageSalaryElement = detailsElements[5]; // 6번째 요소
      const turnoverEntryElement = detailsElements[12]; // 13번째 요소

      const averageSalaryText = averageSalaryElement
        ? averageSalaryElement.innerText
            .trim()
            .replace(/\n/g, "")
            .replace(/만원/, "")
        : "N/A";

      const turnoverEntryText = turnoverEntryElement
        ? turnoverEntryElement.innerText.replace(/[\n\r]/g, "").trim() // 개행 문자 제거
        : "N/A";

      return [averageSalaryText, turnoverEntryText];
    });
  } catch (error) {
    console.error("Error while extracting company details:", error);
  }

  return { foundedYear, features, averageSalary, turnoverEntry };
}

// 직무 상세 페이지와 회사 상세 페이지 탐색 및 정보 추출
async function extractDetails(page, job, companyDetailsList) {
  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30000 });

    await page.evaluate(async () => {
      await new Promise((resolve) => {
        const observer = new MutationObserver((mutations, observerInstance) => {
          if (document.querySelector('[class*="wds-wcfcu3"] > span')) {
            observerInstance.disconnect(); // 관찰 중지
            resolve();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    });

    let techDetails = await page
      .$eval(
        '[class*="wds-wcfcu3"] > span',
        (element) =>
          element.innerText.trim().replace(/\n/g, " ").substring(0, 100) // 첫 100글자까지만 저장
      )
      .catch(() => "N/A");

    const location = await page
      .$$eval('[class*="JobHeader__Tools__Company__Info"]', (elements) =>
        elements.length > 0 ? elements[0].innerText.trim() : "N/A"
      )
      .catch(() => "N/A");

    const companyLinkSelector = '[class*="JobHeader__Tools__Company__Link"]';
    const companyLink = await page.$(companyLinkSelector);

    let companyDetails = {
      foundedYear: "N/A",
      features: "N/A",
      averageSalary: "N/A",
      turnoverEntry: "N/A",
    };

    const companyName = job.company;
    const isTechDetailsDuplicated = companyDetailsList.some(
      (detail) => detail.techDetails === techDetails
    );

    if (isTechDetailsDuplicated) {
      techDetails = "-";
    }

    if (
      companyDetailsList.some((detail) => detail.companyName === companyName)
    ) {
      console.log(`Skipping ${companyName}, already processed.`);
      companyDetails = {
        foundedYear: "-",
        features: "-",
        averageSalary: "-",
        turnoverEntry: "-",
      }; // 중복된 경우 "-"로 저장
    } else {
      if (companyLink) {
        await Promise.all([
          page.waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 30000,
          }),
          companyLink.click(),
        ]);

        companyDetails = await getCompanyDetails(page);
        companyDetailsList.push({ companyName, techDetails, ...companyDetails });
      }
    }

    job.techDetails = techDetails;
    job.location = location;
    job.foundedYear = companyDetails.foundedYear;
    job.features = companyDetails.features;
    job.averageSalary = companyDetails.averageSalary;
    job.turnoverEntry = companyDetails.turnoverEntry;
  } catch (error) {
    if (error.name === "TimeoutError") {
      console.error(`Timeout error for ${job.url}: ${error.message}`);
      saveDataToFile(companyDetailsList); // 타임아웃 발생 시까지의 데이터 저장
    } else {
      console.error(`Failed to extract details for ${job.url}`, error);
    }
    job.techDetails = "N/A";
    job.location = "N/A";
    job.foundedYear = "N/A";
    job.features = "N/A";
    job.averageSalary = "N/A";
    job.turnoverEntry = "N/A";
  }
}

// 데이터를 파일로 저장하는 함수
async function saveDataToFile(data) {
  const now = new Date();
  const formattedDate = `${now.getFullYear()}${String(
    now.getMonth() + 1
  ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(
    now.getHours()
  ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const filePath = path.resolve(`exports/job_list_${formattedDate}.csv`);

  stringify(
    data,
    {
      header: true,
      columns: [
        { key: "company", header: "Company" },
        { key: "position", header: "Position" },
        { key: "url", header: "URL" },
        { key: "techDetails", header: "Tech Details" },
        { key: "location", header: "Location" },
        { key: "foundedYear", header: "Founded Year" },
        { key: "features", header: "Features" },
        { key: "averageSalary", header: "Average Salary" },
        { key: "turnoverEntry", header: "Turnover Entry" },
      ],
    },
    (err, output) => {
      if (err) {
        console.error("Error generating CSV output:", err);
        return;
      }

      // UTF-8 with BOM
      const bom = "\uFEFF";
      fs.writeFile(filePath, bom + output, "utf8", (writeErr) => {
        if (writeErr) {
          console.error("Error while saving CSV data:", writeErr);
        } else {
          console.log(`Job data saved to ${filePath}`);
        }
      });
    }
  );
}

// 실행
getJobList().catch((error) => {
  console.error("Error in script execution:", error);
});
