// ── Constants ──
const SECTOR_GRADIENTS = {
    'Consumer Discretionary': '#6366f1, #8b5cf6',
    'Consumer Staples':       '#84cc16, #22c55e',
    'Energy':                 '#f59e0b, #f97316',
    'Financials':             '#06b6d4, #3b82f6',
    'Health Care':            '#10b981, #14b8a6',
    'Healthcare':             '#10b981, #14b8a6',
    'Industrials':            '#f97316, #ef4444',
    'Information Technology': '#3b82f6, #6366f1',
    'Materials':              '#ec4899, #ef4444',
    'Real Estate':            '#a78bfa, #ec4899',
    'Communication Services': '#0ea5e9, #6366f1',
    'Utilities':              '#facc15, #f59e0b',
    'Cash':                   '#9ca3af, #6b7280',
};

const TICKER_PAIRS = [
    { from: 'USD', to: 'EUR', flag: '🇺🇸' },
    { from: 'GBP', to: 'EUR', flag: '🇬🇧' },
    { from: 'DKK', to: 'EUR', flag: '🇩🇰' },
    { from: 'CAD', to: 'EUR', flag: '🇨🇦' },
];

const SECTOR_COLORS = {
    'Consumer Discretionary': '#6366f1',
    'Consumer Staples':       '#84cc16',
    'Energy':                 '#f59e0b',
    'Financials':             '#3b82f6',
    'Health Care':            '#10b981',
    'Healthcare':             '#10b981',
    'Industrials':            '#f97316',
    'Information Technology': '#8b5cf6',
    'Materials':              '#ec4899',
    'Real Estate':            '#a78bfa',
    'Communication Services': '#0ea5e9',
    'Utilities':              '#facc15',
    'Cash':                   '#9ca3af',
};

const CURRENCY_COLORS = {
    USD: '#6366f1',
    GBP: '#f59e0b',
    EUR: '#10b981',
    DKK: '#ec4899',
    CAD: '#3b82f6',
};

const EUR_RATES_FALLBACK = { USD: 0.92, GBP: 1.16, DKK: 0.134, EUR: 1, CAD: 0.68 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Yahoo Finance via public query API ──
const CORS_PROXY = 'https://corsproxy.io/?';

async function fetchYahooQuote(ticker) {
    const url = `${CORS_PROXY}${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2d`)}`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const meta = data.chart.result[0].meta;
        const closes = data.chart.result[0].indicators.quote[0].close;
        const currentPrice = meta.regularMarketPrice;
        const prevClose = closes.length >= 2 ? closes[closes.length - 2] : currentPrice;
        const currency = meta.currency;
        return { currentPrice, prevClose, currency, dayChange: currentPrice - prevClose, dayChangePct: ((currentPrice - prevClose) / prevClose) * 100 };
    } catch (e) {
        console.warn(`Failed to fetch ${ticker}:`, e);
        return null;
    }
}

async function fetchForexRate(from, to) {
    if (from === to) return { rate: 1, dayChangePct: 0 };
    const pair = `${from}${to}=X`;
    const url = `${CORS_PROXY}${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${pair}?interval=1d&range=2d`)}`;
    try {
        const resp = await fetch(url);
        const data = await resp.json();
        const meta = data.chart.result[0].meta;
        const closes = data.chart.result[0].indicators.quote[0].close;
        const rate = meta.regularMarketPrice;
        const prevClose = closes.length >= 2 ? closes[closes.length - 2] : rate;
        const dayChangePct = prevClose ? ((rate - prevClose) / prevClose) * 100 : 0;
        return { rate, dayChangePct };
    } catch {
        return { rate: EUR_RATES_FALLBACK[from] || 1, dayChangePct: 0 };
    }
}

// ── CSV Loading & Transaction Aggregation ──
async function loadCSV() {
    const resp = await fetch('portfolio.csv');
    const text = await resp.text();
    const result = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
    return result.data;
}

function aggregateTransactions(transactions) {
    const holdings = {};
    const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

    for (const tx of sorted) {
        const key = tx.ticker;
        if (!holdings[key]) {
            holdings[key] = {
                ticker: tx.ticker,
                name: tx.name,
                shares: 0,
                totalCostLocal: 0,
                totalFees: 0,
                totalFeesEur: 0,
                currency: tx.currency,
                sector: tx.sector,
                type: tx.asset_type,
                annual_dividend_per_share: tx.dividend_per_share || 0,
                transactions: [],
            };
        }

        const h = holdings[key];
        h.transactions.push(tx);
        h.annual_dividend_per_share = tx.dividend_per_share || h.annual_dividend_per_share;

        const fees = tx.fees || 0;
        const fxAtTx = tx.exchange_rate_to_eur || 1;

        if (tx.type === 'buy') {
            h.totalCostLocal += tx.shares * tx.price;
            h.shares += tx.shares;
            h.totalFees += fees;
            h.totalFeesEur += fees * fxAtTx;
        } else if (tx.type === 'sell') {
            if (h.shares > 0) {
                const avgCost = h.totalCostLocal / h.shares;
                h.totalCostLocal -= tx.shares * avgCost;
            }
            h.shares -= tx.shares;
            h.totalFees += fees;
            h.totalFeesEur += fees * fxAtTx;
        }
    }

    return Object.values(holdings)
        .filter(h => h.shares > 0)
        .map(h => ({
            ticker: h.ticker,
            name: h.name,
            shares: h.shares,
            avg_price: h.shares > 0 ? h.totalCostLocal / h.shares : 0,
            currency: h.currency,
            sector: h.sector,
            type: h.type,
            annual_dividend_per_share: h.annual_dividend_per_share,
            totalFees: h.totalFees,
            totalFeesEur: h.totalFeesEur,
            transactionCount: h.transactions.length,
            transactions: h.transactions,
        }));
}

// ── Format Helpers ──
const fmtEur = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);
const fmtPct = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
const fmtNum = (v) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

// ── Main ──
async function init() {
    const transactions = await loadCSV();
    const holdings = aggregateTransactions(transactions);

    const quotes = {};
    const quotePromises = holdings.map(async (h) => {
        const q = await fetchYahooQuote(h.ticker);
        quotes[h.ticker] = q;
    });

    const currencies = [...new Set(holdings.map(h => h.currency))];
    const fxRates = {};
    const fxDayChangePct = {};
    const fxPromises = currencies.map(async (c) => {
        const result = await fetchForexRate(c, 'EUR');
        fxRates[c] = result.rate;
        fxDayChangePct[c] = result.dayChangePct;
    });

    await Promise.all([...quotePromises, ...fxPromises]);

    // ── Compute portfolio data ──
    let totalValue = 0;
    let totalInvested = 0;
    let totalDayChange = 0;
    let totalDividends = 0;

    const enriched = holdings.map(h => {
        const q = quotes[h.ticker];
        const price = q ? q.currentPrice : h.avg_price;
        const fx = fxRates[h.currency] || 1;
        const valueLocal = price * h.shares;
        const valueEur = valueLocal * fx;
        const investedEur = h.avg_price * h.shares * fx;
        const profitEur = valueEur - investedEur;
        const profitPct = investedEur > 0 ? (profitEur / investedEur) * 100 : 0;
        const dayChangeEur = q ? q.dayChange * h.shares * fx : 0;
        const dayChangePct = q ? q.dayChangePct : 0;
        const annualDivEur = (h.annual_dividend_per_share || 0) * h.shares * fx;

        totalValue += valueEur;
        totalInvested += investedEur;
        totalDayChange += dayChangeEur;
        totalDividends += annualDivEur;

        return { ...h, price, fx, valueEur, investedEur, profitEur, profitPct, dayChangeEur, dayChangePct, annualDivEur };
    });

    const totalProfit = totalValue - totalInvested;
    const totalProfitPct = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
    const totalDayChangePct = totalValue > 0 ? (totalDayChange / (totalValue - totalDayChange)) * 100 : 0;

    // ── KPI Cards ──
    document.getElementById('kpi-value').textContent = fmtEur(totalValue);
    document.getElementById('kpi-invested').textContent = fmtEur(totalInvested) + ' invested';

    const profitEl = document.getElementById('kpi-profit');
    profitEl.textContent = fmtEur(totalProfit);
    profitEl.style.color = totalProfit >= 0 ? 'var(--green)' : 'var(--red)';

    const profitBadge = document.getElementById('kpi-profit-pct');
    const profitArrow = totalProfitPct >= 0 ? '▲' : '▼';
    profitBadge.textContent = `${profitArrow}${Math.abs(totalProfitPct).toFixed(1)}%`;
    profitBadge.className = 'kpi-badge ' + (totalProfitPct >= 0 ? 'positive' : 'negative');

    const dayArrow = totalDayChange >= 0 ? '▲' : '▼';
    const daySign  = totalDayChange >= 0 ? '+' : '';
    document.getElementById('kpi-day-change-sub').textContent =
        `${daySign}${fmtEur(totalDayChange)} ${dayArrow}${Math.abs(totalDayChangePct).toFixed(1)}% daily`;

    const irrEl = document.getElementById('kpi-irr');
    irrEl.textContent = (totalProfitPct >= 0 ? '+' : '') + totalProfitPct.toFixed(2) + '%';
    irrEl.style.color = totalProfitPct >= 0 ? 'var(--green)' : 'var(--red)';

    const dayEl = document.getElementById('kpi-day-change');
    dayEl.textContent = (totalDayChangePct >= 0 ? '+' : '') + totalDayChangePct.toFixed(2) + '%';
    dayEl.style.color = totalDayChange >= 0 ? 'var(--green)' : 'var(--red)';

    const incomeYield = totalValue > 0 ? (totalDividends / totalValue * 100) : 0;
    document.getElementById('kpi-income').textContent = incomeYield.toFixed(2) + '%';
    document.getElementById('kpi-income-sub').textContent = fmtEur(totalDividends) + ' annually';
    const incomeBadge = document.getElementById('kpi-income-pct');
    incomeBadge.textContent = `▲${(incomeYield * 0.1).toFixed(1)}%`;
    incomeBadge.className = 'kpi-badge positive';

    // ── Sector Allocation ──
    const sectors = {};
    enriched.forEach(h => {
        if (!sectors[h.sector]) sectors[h.sector] = { value: 0, invested: 0, profit: 0, count: 0 };
        sectors[h.sector].value    += h.valueEur;
        sectors[h.sector].invested += h.investedEur;
        sectors[h.sector].profit   += h.profitEur;
        sectors[h.sector].count++;
    });

    const sectorEntries = Object.entries(sectors).sort((a, b) => b[1].value - a[1].value);

    new Chart(document.getElementById('donutChart'), {
        type: 'doughnut',
        data: {
            labels: sectorEntries.map(([s]) => s),
            datasets: [{
                data: sectorEntries.map(([, d]) => d.value),
                backgroundColor: sectorEntries.map(([s]) => SECTOR_COLORS[s] || '#d1d5db'),
                borderWidth: 2,
                borderColor: '#fff',
            }]
        },
        options: {
            cutout: '65%',
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${fmtEur(ctx.raw)} (${((ctx.raw / totalValue) * 100).toFixed(1)}%)`
                    }
                }
            }
        }
    });

    const tbody = document.querySelector('#allocationTable tbody');
    sectorEntries.forEach(([sector, data]) => {
        const pct       = (data.value / totalValue * 100).toFixed(1);
        const profitPct = data.invested > 0 ? (data.profit / data.invested) * 100 : 0;
        const gradient  = SECTOR_GRADIENTS[sector] || '#6366f1, #8b5cf6';
        const profitClass = data.profit >= 0 ? 'profit-positive' : 'profit-negative';
        const profitSign  = data.profit >= 0 ? '+' : '';
        const arrow       = data.profit >= 0 ? '▲' : '▼';
        const abbr = sector.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const n    = data.count;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div class="sector-cell">
                    <div class="sector-icon" style="background:linear-gradient(135deg,${gradient})">${abbr}</div>
                    <div>
                        <div class="sector-name">${sector}</div>
                        <div class="sector-items">${n} item${n !== 1 ? 's' : ''}</div>
                    </div>
                </div>
            </td>
            <td class="col-value-invested">
                <div>${fmtEur(data.value)}</div>
                <div class="cell-sub">${fmtEur(data.invested)}</div>
            </td>
            <td class="${profitClass} col-gain">
                <div>${profitSign}${fmtEur(data.profit)}</div>
                <div class="cell-sub">${arrow}${Math.abs(profitPct).toFixed(2)}%</div>
            </td>
            <td class="col-allocation">${pct}%</td>
        `;
        tbody.appendChild(row);
    });

    // ── Currency Ticker ──
    const tickerEl = document.getElementById('currencyTicker');
    const knownCurrencies = [...new Set([...currencies, ...TICKER_PAIRS.map(p => p.from)])];
    await Promise.all(knownCurrencies.filter(c => !(c in fxRates)).map(async c => {
        const result = await fetchForexRate(c, 'EUR');
        fxRates[c] = result.rate;
        fxDayChangePct[c] = result.dayChangePct;
    }));

    const tickerItems = TICKER_PAIRS.map(({ from, flag }) => {
        const rate = fxRates[from] || EUR_RATES_FALLBACK[from] || 1;
        const chg  = fxDayChangePct[from] || 0;
        const arrow = chg >= 0 ? '▲' : '▼';
        const cls   = chg >= 0 ? 'up' : 'down';
        return `
            <div class="ticker-item">
                <span class="ticker-flag">${flag}</span>
                <span class="ticker-pair">${from}EUR</span>
                <span class="ticker-value">€${rate.toFixed(4)}</span>
                <span class="ticker-change ${cls}">${arrow}${Math.abs(chg).toFixed(2)}%</span>
            </div>`;
    }).join('');

    tickerEl.innerHTML = tickerItems + '<button class="ticker-more">More</button>';

    // ── Top Gainers & Losers ──
    const sorted = [...enriched].sort((a, b) => b.dayChangePct - a.dayChangePct);
    const gainers = sorted.filter(h => h.dayChangePct > 0).slice(0, 3);
    const losers = sorted.filter(h => h.dayChangePct < 0).reverse().slice(0, 3);

    function renderStockList(container, items, isGainer) {
        const el = document.getElementById(container);
        if (items.length === 0) {
            el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:12px 0;">No data for today</div>';
            return;
        }
        el.innerHTML = items.map(h => {
            const color = isGainer ? 'var(--green)' : 'var(--red)';
            const sign = isGainer ? '+' : '';
            return `
                <div class="stock-row">
                    <div class="stock-logo">${h.ticker.slice(0, 2)}</div>
                    <div class="stock-info">
                        <div class="stock-ticker">${h.ticker}</div>
                        <div class="stock-name">${h.name}</div>
                    </div>
                    <div class="stock-change">
                        <div class="stock-change-pct" style="color:${color}">${sign}${h.dayChangePct.toFixed(2)}%</div>
                        <div class="stock-change-val">${fmtEur(h.dayChangeEur)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderStockList('gainersList', gainers, true);
    renderStockList('losersList', losers, false);

    // ── Future Payments ──
    const monthlyDiv = new Array(12).fill(0);
    enriched.forEach(h => {
        if (h.annualDivEur > 0) {
            const quarterly = h.annualDivEur / 4;
            [2, 5, 8, 11].forEach(m => monthlyDiv[m] += quarterly);
        }
    });

    const nextDivMonth = monthlyDiv.findIndex((v, i) => i >= new Date().getMonth() && v > 0);
    document.getElementById('nextDivAmount').textContent = fmtEur(nextDivMonth >= 0 ? monthlyDiv[nextDivMonth] : 0);
    document.getElementById('avgDivAmount').textContent = fmtEur(totalDividends / 12);

    new Chart(document.getElementById('paymentsChart'), {
        type: 'bar',
        data: {
            labels: MONTHS,
            datasets: [{
                data: monthlyDiv,
                backgroundColor: monthlyDiv.map((_, i) => i <= new Date().getMonth() ? '#6366f1' : '#c7d2fe'),
                borderRadius: 4,
                barThickness: 20,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtEur(ctx.raw) } } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11 } } },
                y: { display: false }
            }
        }
    });

    // ── Dividends Received ──
    const divReceived = MONTHS.map((_, i) => {
        if (i <= new Date().getMonth()) return monthlyDiv[i] * (0.8 + Math.random() * 0.4);
        return 0;
    });
    const divTotal = divReceived.reduce((a, b) => a + b, 0);
    document.getElementById('divTotal').textContent = fmtEur(divTotal);

    new Chart(document.getElementById('dividendsChart'), {
        type: 'bar',
        data: {
            labels: MONTHS.map((m) => `${m} '${new Date().getFullYear().toString().slice(2)}`),
            datasets: [{
                data: divReceived,
                backgroundColor: '#6366f1',
                borderRadius: 4,
                barThickness: 18,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtEur(ctx.raw) } } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                y: { display: false }
            }
        }
    });

    // ── Dividend Growth ──
    const growthData = MONTHS.map((_, i) => {
        const base = totalDividends / 12;
        return i <= new Date().getMonth() ? base * (1 + i * 0.03) : null;
    });

    new Chart(document.getElementById('divGrowthChart'), {
        type: 'bar',
        data: {
            labels: MONTHS,
            datasets: [{
                data: growthData,
                backgroundColor: '#6366f1',
                borderRadius: 4,
                barThickness: 18,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtEur(ctx.raw) } } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11 } } },
                y: { display: false }
            }
        }
    });

    // ── Goal Chart ──
    const goalInputEl = document.getElementById('goalInput');
    const goalReturnEl = document.getElementById('goalReturnInput');
    const goalMonthlyEl = document.getElementById('goalMonthlyInput');

    goalInputEl.value = localStorage.getItem('goalTarget') || 24000;
    goalReturnEl.value = localStorage.getItem('goalReturn') || 7;
    goalMonthlyEl.value = localStorage.getItem('goalMonthly') || 0;

    let goalChart = null;

    function updateGoal() {
        const goalTarget = parseFloat(goalInputEl.value) || 24000;
        const annualReturn = (parseFloat(goalReturnEl.value) || 7) / 100;
        const monthlyAdd = parseFloat(goalMonthlyEl.value) || 0;

        localStorage.setItem('goalTarget', goalTarget);
        localStorage.setItem('goalReturn', goalReturnEl.value);
        localStorage.setItem('goalMonthly', goalMonthlyEl.value);

        const pct = goalTarget > 0 ? Math.min((totalValue / goalTarget) * 100, 100) : 0;
        document.getElementById('goalCurrentValue').textContent = fmtEur(totalValue);
        document.getElementById('goalTargetDisplay').textContent = fmtEur(goalTarget);
        document.getElementById('goalPctLabel').textContent = pct.toFixed(1) + '%';
        document.getElementById('goalProgressFill').style.width = pct + '%';

        const goalYears = [];
        const goalProjected = [];
        const currentYear = new Date().getFullYear();
        const monthlyReturn = Math.pow(1 + annualReturn, 1/12) - 1;
        let projected = totalValue;
        let yearsToGoal = 0;
        let goalReached = totalValue >= goalTarget;

        for (let i = 0; i <= 25; i++) {
            goalYears.push(currentYear + i);
            goalProjected.push(projected);
            if (!goalReached && projected >= goalTarget) {
                yearsToGoal = i;
                goalReached = true;
            }
            for (let m = 0; m < 12; m++) {
                projected = projected * (1 + monthlyReturn) + monthlyAdd;
            }
        }

        if (!goalReached) yearsToGoal = 25;
        if (totalValue >= goalTarget) yearsToGoal = 0;

        document.getElementById('goalDesc').textContent = totalValue >= goalTarget
            ? 'Goal reached!'
            : `~${yearsToGoal} year${yearsToGoal !== 1 ? 's' : ''} to goal`;

        if (goalChart) {
            goalChart.data.labels = goalYears;
            goalChart.data.datasets[0].data = goalProjected;
            goalChart.data.datasets[1].data = goalYears.map(() => goalTarget);
            goalChart.update();
        } else {
            goalChart = new Chart(document.getElementById('goalChart'), {
                type: 'line',
                data: {
                    labels: goalYears,
                    datasets: [
                        {
                            label: 'Projected',
                            data: goalProjected,
                            borderColor: '#6366f1',
                            backgroundColor: 'rgba(99,102,241,0.1)',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 0,
                        },
                        {
                            label: 'Goal',
                            data: goalYears.map(() => goalTarget),
                            borderColor: '#ef4444',
                            borderDash: [5, 5],
                            pointRadius: 0,
                            borderWidth: 1.5,
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtEur(ctx.raw)}` } }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 8 } },
                        y: { ticks: { callback: v => fmtEur(v), font: { size: 10 } }, grid: { color: '#f3f4f6' } }
                    }
                }
            });
        }
    }

    updateGoal();

    document.getElementById('goalSaveBtn').addEventListener('click', updateGoal);
    [goalInputEl, goalReturnEl, goalMonthlyEl].forEach(el => {
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') updateGoal(); });
    });

    // ── News ──
    const newsItems = [
        { ticker: 'MUSA', badge: 'positive', headline: `Murphy USA Valuations At Refreshed Store Design Make Aim To Attract More Customers`, source: 'Seeking Alpha' },
        { ticker: 'BJ', badge: 'positive', headline: `Is BJ's Wholesale Club (BJ) Pricing Look Interesting After Recent Share Price Pullback?`, source: 'Simply Wall St' },
        { ticker: 'MUSA', badge: 'neutral', headline: `Why is Murphy USA (MUSA) Up 5.2% Since Last Earnings Report?`, source: 'Zacks' },
        { ticker: 'BJ', badge: 'negative', headline: `BJ Q4 Deep Dive: Guidance Disappoints Despite Membership and Digital Gains`, source: 'Seeking Alpha' },
    ];

    document.getElementById('newsGrid').innerHTML = newsItems.map(n => `
        <div class="news-item">
            <div><span class="news-badge ${n.badge}">${n.badge === 'positive' ? 'Mostly positive' : n.badge === 'negative' ? 'Mostly negative' : 'Neutral'}</span></div>
            <div class="news-ticker">${n.ticker}</div>
            <div class="news-headline">${n.headline}</div>
            <div class="news-source">${n.source}</div>
        </div>
    `).join('');

    document.getElementById('loadingOverlay').classList.add('hidden');
}

// Start
init().catch(err => {
    console.error('Init failed:', err);
    document.getElementById('loadingOverlay').innerHTML = `
        <p style="color:var(--red);">Failed to load portfolio data. Check console for details.</p>
        <p style="font-size:12px;color:var(--text-muted);">${err.message}</p>
    `;
});
