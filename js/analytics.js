/**
 * Snowball Analytics - Portfolio compound growth engine
 */

(function () {
  "use strict";

  // ── Calculation Engine ──

  function calculatePortfolioGrowth(params) {
    const {
      initialInvestment,
      monthlyContribution,
      annualReturn,
      years,
      dividendYield,
      reinvestDividends,
    } = params;

    const monthlyReturn = annualReturn / 100 / 12;
    const monthlyDivYield = dividendYield / 100 / 12;
    const yearlyData = [];

    let totalValue = initialInvestment;
    let totalContributions = initialInvestment;
    let totalDividends = 0;
    let totalCapitalGains = 0;

    for (let year = 1; year <= years; year++) {
      let yearDividends = 0;
      let yearCapitalGains = 0;
      let yearContributions = 0;

      for (let month = 0; month < 12; month++) {
        // Monthly contribution
        totalValue += monthlyContribution;
        totalContributions += monthlyContribution;
        yearContributions += monthlyContribution;

        // Dividends
        const dividend = totalValue * monthlyDivYield;
        yearDividends += dividend;
        totalDividends += dividend;
        if (reinvestDividends) {
          totalValue += dividend;
        }

        // Capital gains (price appreciation)
        const gain = totalValue * monthlyReturn;
        yearCapitalGains += gain;
        totalCapitalGains += gain;
        totalValue += gain;
      }

      // Snowball effect: how much of the gain came from prior gains/dividends
      const pureContributionGrowth =
        totalContributions * (Math.pow(1 + annualReturn / 100, year) - 1);
      const snowballEffect = Math.max(
        0,
        totalValue - totalContributions - pureContributionGrowth
      );

      yearlyData.push({
        year,
        contributions: totalContributions,
        dividends: totalDividends,
        capitalGains: totalCapitalGains,
        totalValue,
        yearDividends,
        yearCapitalGains,
        yearContributions,
        snowballEffect,
      });
    }

    return yearlyData;
  }

  function computeSnowballScore(data) {
    if (data.length === 0) return 0;
    const last = data[data.length - 1];
    const gainFromCompounding = last.totalValue - last.contributions;
    const ratio = gainFromCompounding / last.contributions;
    // Score 0-100 based on how much compounding has multiplied the contributions
    return Math.min(100, Math.round(ratio * 25));
  }

  function snowballLabel(score) {
    if (score < 15) return "Getting Started";
    if (score < 35) return "Building Momentum";
    if (score < 55) return "Rolling Strong";
    if (score < 75) return "Avalanche Mode";
    return "Unstoppable";
  }

  // ── Formatting ──

  function fmt(n) {
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  // ── Charts ──

  let growthChart, breakdownChart, incomeChart;

  const chartColors = {
    totalValue: "#2563eb",
    contributions: "#64748b",
    dividends: "#10b981",
    capitalGains: "#f59e0b",
    snowball: "#8b5cf6",
  };

  function renderGrowthChart(data) {
    const ctx = document.getElementById("growthChart").getContext("2d");
    const labels = data.map((d) => "Year " + d.year);

    if (growthChart) growthChart.destroy();

    growthChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Total Value",
            data: data.map((d) => d.totalValue),
            borderColor: chartColors.totalValue,
            backgroundColor: chartColors.totalValue + "20",
            fill: true,
            tension: 0.3,
          },
          {
            label: "Total Contributions",
            data: data.map((d) => d.contributions),
            borderColor: chartColors.contributions,
            borderDash: [6, 3],
            fill: false,
            tension: 0.1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.dataset.label + ": " + fmt(ctx.parsed.y),
            },
          },
        },
        scales: {
          y: {
            ticks: {
              callback: (v) => fmt(v),
            },
          },
        },
      },
    });
  }

  function renderBreakdownChart(data) {
    const ctx = document.getElementById("breakdownChart").getContext("2d");
    const last = data[data.length - 1];

    if (breakdownChart) breakdownChart.destroy();

    breakdownChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Contributions", "Dividends", "Capital Gains"],
        datasets: [
          {
            data: [last.contributions, last.dividends, last.capitalGains],
            backgroundColor: [
              chartColors.contributions,
              chartColors.dividends,
              chartColors.capitalGains,
            ],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.label + ": " + fmt(ctx.parsed),
            },
          },
        },
      },
    });
  }

  function renderIncomeChart(data) {
    const ctx = document.getElementById("incomeChart").getContext("2d");
    const labels = data.map((d) => "Year " + d.year);

    if (incomeChart) incomeChart.destroy();

    incomeChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Annual Dividends",
            data: data.map((d) => d.yearDividends),
            backgroundColor: chartColors.dividends,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.dataset.label + ": " + fmt(ctx.parsed.y),
            },
          },
        },
        scales: {
          y: {
            ticks: {
              callback: (v) => fmt(v),
            },
          },
        },
      },
    });
  }

  // ── Table ──

  function renderTable(data) {
    const tbody = document.querySelector("#yearTable tbody");
    tbody.innerHTML = data
      .map(
        (d) => `
      <tr>
        <td>${d.year}</td>
        <td>${fmt(d.contributions)}</td>
        <td>${fmt(d.dividends)}</td>
        <td>${fmt(d.capitalGains)}</td>
        <td>${fmt(d.totalValue)}</td>
        <td>${fmt(d.snowballEffect)}</td>
      </tr>`
      )
      .join("");
  }

  // ── Summary Cards ──

  function renderSummary(data) {
    const last = data[data.length - 1];
    const totalReturn = last.totalValue - last.contributions;
    const returnPct = (totalReturn / last.contributions) * 100;
    const score = computeSnowballScore(data);

    document.getElementById("totalValue").textContent = fmt(last.totalValue);
    document.getElementById("totalInvested").textContent = fmt(
      last.contributions
    );
    document.getElementById("totalReturn").textContent = fmt(totalReturn);

    const pctEl = document.getElementById("totalReturnPct");
    pctEl.textContent = returnPct.toFixed(1) + "%";
    pctEl.className = "card-change " + (totalReturn >= 0 ? "positive" : "negative");

    document.getElementById("snowballScore").textContent = score;
    document.getElementById("snowballLabel").textContent = snowballLabel(score);
  }

  // ── Main ──

  function run() {
    const params = {
      initialInvestment: parseFloat(
        document.getElementById("initialInvestment").value
      ),
      monthlyContribution: parseFloat(
        document.getElementById("monthlyContribution").value
      ),
      annualReturn: parseFloat(document.getElementById("annualReturn").value),
      years: parseInt(document.getElementById("years").value, 10),
      dividendYield: parseFloat(
        document.getElementById("dividendYield").value
      ),
      reinvestDividends:
        document.getElementById("dividendReinvest").value === "yes",
    };

    const data = calculatePortfolioGrowth(params);

    renderSummary(data);
    renderGrowthChart(data);
    renderBreakdownChart(data);
    renderIncomeChart(data);
    renderTable(data);
  }

  document.getElementById("portfolioForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });

  // Initial calculation on load
  run();
})();
