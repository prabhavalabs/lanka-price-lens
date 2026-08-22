import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const reportRoot = resolve(process.cwd(), "reports/pdf-workflow-validation-2026-08-22");
const analysis = JSON.parse(await readFile(resolve(reportRoot, "analysis-output.json"), "utf8"));
const batch = JSON.parse(await readFile(resolve(reportRoot, "batch-results.json"), "utf8"));
const summary = analysis.summary;
const generatedAt = new Date().toISOString();
const artifactIds = batch.documents
  .flatMap((document: { artifact_id: string | null }) => document.artifact_id ? [document.artifact_id] : [])
  .map((artifactId: string) => `'${artifactId.replaceAll("'", "''")}'`)
  .join(", ");

const sourceSql = `SELECT observation.source_date,
       observation.source_item_label AS item,
       observation.source_market_label AS market,
       observation.source_unit AS unit,
       observation.min_value_minor / 100.0 AS min_lkr,
       observation.max_value_minor / 100.0 AS max_lkr
FROM staging_observation AS observation
JOIN source_artifact AS artifact ON artifact.id = observation.artifact_id
JOIN source_publication AS publication ON publication.id = artifact.publication_id
WHERE observation.artifact_id IN (${artifactIds});`;

const artifact = {
  manifest: {
    version: 1,
    surface: "report",
    title: "Recent PDF Workflow Validation and Price Trends",
    description: "A reproducible validation of 120 recent HARTI PDFs processed through the application workflow, with data-quality and price-trend findings.",
    generatedAt,
    sources: [
      {
        id: "validation-source",
        label: "Lanka PriceLens local validation database",
        path: "reports/pdf-workflow-validation-2026-08-22/analysis-output.json",
        query: {
          engine: "SQLite",
          sql: sourceSql,
          description: "Staging observations produced by the 120 workflow runs frozen in batch-results.json.",
          executed_at: analysis.generated_at,
          language: "SQL",
          filters: [
            "Random archived HARTI publications dated 2026-04-01 through 2026-08-22",
            "Previously successful PDF-processing runs excluded before sampling",
            "Price charts use Peliyagoda kg observations and prefer the publication closest to each source date",
          ],
          metric_definitions: [
            "Midpoint price = (published minimum + published maximum) / 2",
            "Period change = median of first 14 available observations versus median of last 14",
            "Relative IQR = (75th percentile - 25th percentile) / median midpoint price",
            "Market date coverage = distinct market source dates / 132 cohort source dates",
          ],
          tables_used: ["staging_observation", "source_artifact", "source_publication", "ingest_run", "run_stage"],
        },
      },
    ],
    cards: [
      { id: "documents-card", description: "PDFs processed through all workflow steps", dataset: "summary", sourceId: "validation-source", metrics: [{ label: "PDFs processed", field: "selected_documents", format: "number" }] },
      { id: "success-card", description: "Share of sampled documents completing successfully", dataset: "summary", sourceId: "validation-source", metrics: [{ label: "Workflow success", field: "success_rate", format: "percent" }] },
      { id: "observations-card", description: "Persisted staging observations", dataset: "summary", sourceId: "validation-source", metrics: [{ label: "Observations stored", field: "stored_observations", format: "compact" }] },
      { id: "validity-card", description: "Rows failing price-range or date checks", dataset: "summary", sourceId: "validation-source", metrics: [{ label: "Invalid rows", field: "invalid_observations", format: "number" }] },
    ],
    charts: [
      {
        id: "monthly-depth",
        title: "Monthly extraction depth",
        subtitle: "Typical yield stayed between 220 and 241 observations per PDF",
        intent: "trend",
        question: "Was extraction depth stable across the validation period?",
        rationale: "A monthly bar chart exposes shifts in typical document yield without hiding the number of documents processed.",
        type: "bar",
        dataset: "monthly_quality",
        sourceId: "validation-source",
        encodings: {
          x: { field: "month", type: "ordinal", label: "Publication month" },
          y: { field: "median_observations_per_pdf", type: "quantitative", label: "Median observations" },
          tooltip: [
            { field: "documents", type: "quantitative", label: "PDFs" },
            { field: "observations", type: "quantitative", label: "Observations" },
            { field: "success_rate", type: "quantitative", format: "percent", label: "Success rate" },
          ],
        },
        xAxisTitle: "Publication month",
        yAxisTitle: "Median observations per PDF",
        valueFormat: "number",
        layout: "full",
        settings: { showValues: true, sort: "custom" },
        surface: { viewMode: "both", interactiveLegend: true },
      },
      {
        id: "price-trend",
        title: "Peliyagoda midpoint prices for selected vegetables",
        subtitle: "Green Chillies and Tomato rose while Carrot moved lower over the observed period",
        intent: "trend",
        question: "How did selected Peliyagoda vegetable price ranges move over the observed period?",
        rationale: "A multi-series line chart preserves daily direction and turning points across four familiar items.",
        type: "line",
        dataset: "price_trend",
        sourceId: "validation-source",
        encodings: {
          x: { field: "date", type: "temporal", label: "Source date" },
          y: { field: "midpoint_lkr", type: "quantitative", label: "Midpoint price", unit: "LKR/kg" },
          color: { field: "item", type: "nominal", label: "Item" },
          tooltip: [
            { field: "item", type: "nominal", label: "Item" },
            { field: "date", type: "temporal", label: "Date" },
            { field: "min_lkr", type: "quantitative", label: "Minimum", unit: "LKR/kg" },
            { field: "max_lkr", type: "quantitative", label: "Maximum", unit: "LKR/kg" },
          ],
        },
        xAxisTitle: "Source date",
        yAxisTitle: "Midpoint price (LKR/kg)",
        valueFormat: "number",
        unit: "LKR/kg",
        layout: "full",
        maxRows: 600,
        legend: { position: "bottom", sort: "labelAsc" },
        settings: { showPoints: "never" },
        surface: { viewMode: "both", interactiveLegend: true },
      },
      {
        id: "directional-extremes",
        title: "First-to-last period price changes",
        subtitle: "Observed changes range from a 63% decline to a 293% increase",
        intent: "comparison",
        question: "Which items moved most between the first and last 14 available observations?",
        rationale: "A diverging horizontal bar chart makes positive and negative price movements directly comparable.",
        type: "horizontalBar",
        dataset: "directional_extremes",
        sourceId: "validation-source",
        encodings: {
          x: { field: "item", type: "nominal", label: "Item" },
          y: { field: "change_rate", type: "quantitative", format: "percent", label: "Change" },
          tooltip: [
            { field: "first_period_median_lkr", type: "quantitative", label: "First-period median", unit: "LKR/kg" },
            { field: "last_period_median_lkr", type: "quantitative", label: "Last-period median", unit: "LKR/kg" },
            { field: "days", type: "quantitative", label: "Observed dates" },
          ],
        },
        xAxisTitle: "Item",
        yAxisTitle: "Change in median midpoint price",
        valueFormat: "percent",
        layout: "full",
        palette: { kind: "diverging", midpoint: 0 },
        referenceLines: [{ axis: "y", value: 0, label: "No change", color: "neutral" }],
        labels: { values: "all" },
        settings: { sort: "ascending", showValues: true },
        surface: { viewMode: "both" },
      },
      {
        id: "market-coverage",
        title: "Source-date coverage by wholesale market",
        subtitle: "Top markets reach 90% date coverage while Veyangoda reaches 69%",
        intent: "comparison",
        question: "How evenly does the processed cohort cover each wholesale market?",
        rationale: "A ranked horizontal bar chart makes coverage gaps immediately visible.",
        type: "horizontalBar",
        dataset: "market_coverage",
        sourceId: "validation-source",
        encodings: {
          x: { field: "market", type: "nominal", label: "Market" },
          y: { field: "date_coverage_rate", type: "quantitative", format: "percent", label: "Date coverage" },
          tooltip: [
            { field: "days", type: "quantitative", label: "Observed dates" },
            { field: "observations", type: "quantitative", label: "Observations" },
            { field: "items", type: "quantitative", label: "Items" },
          ],
        },
        xAxisTitle: "Wholesale market",
        yAxisTitle: "Date coverage",
        valueFormat: "percent",
        layout: "full",
        palette: { kind: "sequential", name: "blue" },
        labels: { values: "all" },
        settings: { sort: "descending", showValues: true },
        surface: { viewMode: "both" },
      },
      {
        id: "volatility",
        title: "Price level and variability by item",
        subtitle: "Green Chillies has the highest relative IQR at 101% of its median",
        intent: "relationship",
        question: "Which items combine high typical prices with high relative variability?",
        rationale: "A scatter plot separates price level from scale-normalized volatility and retains observation coverage as point size.",
        type: "scatter",
        dataset: "volatility",
        sourceId: "validation-source",
        encodings: {
          x: { field: "median_midpoint_lkr", type: "quantitative", label: "Median midpoint", unit: "LKR/kg" },
          y: { field: "relative_iqr", type: "quantitative", format: "percent", label: "Relative IQR" },
          size: { field: "days", type: "quantitative", label: "Observed dates" },
          label: { field: "item", type: "text", label: "Item" },
          tooltip: [
            { field: "item", type: "nominal", label: "Item" },
            { field: "median_midpoint_lkr", type: "quantitative", label: "Median midpoint", unit: "LKR/kg" },
            { field: "relative_iqr", type: "quantitative", format: "percent", label: "Relative IQR" },
            { field: "min_midpoint_lkr", type: "quantitative", label: "Minimum midpoint", unit: "LKR/kg" },
            { field: "max_midpoint_lkr", type: "quantitative", label: "Maximum midpoint", unit: "LKR/kg" },
          ],
        },
        xAxisTitle: "Median midpoint price (LKR/kg)",
        yAxisTitle: "IQR ÷ median",
        valueFormat: "percent",
        layout: "full",
        palette: { kind: "categorical" },
        surface: { viewMode: "both" },
      },
    ],
    tables: [
      {
        id: "document-extremes",
        title: "Lowest and highest observation counts per PDF",
        subtitle: "Eight lowest-yield and eight highest-yield documents in the cohort",
        dataset: "document_extremes",
        defaultSort: { field: "observations", direction: "asc" },
        density: "dense",
        sourceId: "validation-source",
        layout: "full",
        columns: [
          { field: "published_date", label: "Published", type: "date" },
          { field: "title", label: "Document", type: "text" },
          { field: "observations", label: "Observations", format: "number" },
          { field: "pages", label: "Pages", format: "number" },
          { field: "parser_strategy", label: "Parser strategy", type: "text" },
          { field: "parser_confidence", label: "Layout confidence", format: "percent" },
          { field: "duration_seconds", label: "Duration (s)", format: "number" },
        ],
      },
    ],
    blocks: [
      { id: "title", type: "markdown", body: "# Recent PDF Workflow Validation and Price Trends\n\n**Validation window:** 1 April–22 August 2026  \\n**Cohort:** 120 randomly selected recent HARTI pricing PDFs", layout: "full", sourceId: "validation-source" },
      { id: "executive-summary", type: "markdown", body: "## Executive Summary\n\nThe current pipeline is reliable for the labelled HARTI market/date-grid family: **all 120 PDFs completed all five workflow steps**, storing **26,893 observations** with no row-level validity failures. The result is strong evidence that recent minor layout variations are now tolerated.\n\nThe main remaining risk is data governance, not workflow execution. All observations remain `unmapped` staging rows, and 48 repeated analytical grains carry revised values across publications. Parser confidence also stayed at 100% while per-document yield ranged from 96 to 252 rows, so a separate completeness score is necessary.\n\nPrice behavior was far from uniform. Under the defined first/last-window comparison, Peliyagoda Green Chillies and Tomato increased sharply, while Carrot and Drumstick declined.", layout: "full", sourceId: "validation-source" },
      { id: "metric-strip", type: "metric-strip", cardIds: ["documents-card", "success-card", "observations-card", "validity-card"], layout: "full", sourceId: "validation-source" },
      { id: "reliability-heading", type: "markdown", body: "## Workflow Reliability Passed the Scale Test\n\nEvery selected document succeeded, with a median end-to-end workflow duration of **0.94 seconds**. Monthly median extraction depth stayed between 220 and 241 observations per PDF. The 96–252 row spread below is nevertheless important: identical layout confidence does not prove that every expected market/item cell was recovered.", layout: "full", sourceId: "validation-source" },
      { id: "monthly-depth-block", type: "chart", chartId: "monthly-depth", layout: "full", sourceId: "validation-source" },
      { id: "document-table-intro", type: "markdown", body: "The document-level extremes identify where a future completeness check should begin. Low-yield PDFs include both two-page and eleven-page files, so page count alone is not a sufficient completeness proxy.", layout: "full", sourceId: "validation-source" },
      { id: "document-table", type: "table", tableId: "document-extremes", layout: "full", sourceId: "validation-source" },
      { id: "trends-heading", type: "markdown", body: "## Selected Price Trends Diverged\n\nDaily range midpoints reveal materially different trajectories. Green Chillies reached the highest peaks and finished well above the early-period level; Tomato also rose strongly. Carrot moved in the opposite direction, while Beans increased more moderately. These are descriptive bulletin trends, not transaction-weighted prices.", layout: "full", sourceId: "validation-source" },
      { id: "price-trend-block", type: "chart", chartId: "price-trend", layout: "full", sourceId: "validation-source" },
      { id: "direction-heading", type: "markdown", body: "## Commodity Direction Was Broad but Uneven\n\nAmong 39 Peliyagoda kg items with at least 60 observed dates, **31 increased, seven declined, and one was flat** between the first and last 14-observation windows. Green Chillies rose from a median LKR 175/kg to LKR 650/kg (+271%), Tomato from LKR 115 to LKR 325 (+183%), while Drumstick fell from LKR 400 to LKR 150 (−63%).", layout: "full", sourceId: "validation-source" },
      { id: "directional-block", type: "chart", chartId: "directional-extremes", layout: "full", sourceId: "validation-source" },
      { id: "coverage-heading", type: "markdown", body: "## Market Coverage Remains Uneven\n\nPeliyagoda, Kandy, and Dambulla each appear on 119 of 132 source dates (90%). Veyangoda appears on 91 dates (69%), and Bandarawela on 99 (75%). Coverage gaps may reflect blanks or schedules in the source bulletins rather than parser failure, but the difference should be visible in downstream analytics.", layout: "full", sourceId: "validation-source" },
      { id: "coverage-block", type: "chart", chartId: "market-coverage", layout: "full", sourceId: "validation-source" },
      { id: "volatility-heading", type: "markdown", body: "## Variability Is Concentrated in Specific Items\n\nGreen Chillies had the highest relative IQR (101% of its median midpoint), followed by Cucumber and Luffa (93% each). The chart separates high nominal prices from high scale-normalized variability so operational monitoring can prioritize unstable series rather than simply expensive ones.", layout: "full", sourceId: "validation-source" },
      { id: "volatility-block", type: "chart", chartId: "volatility", layout: "full", sourceId: "validation-source" },
      { id: "recommendations", type: "markdown", body: "## Recommended Next Steps\n\n1. **Add a completeness score** independent of parser-strategy confidence: expected markets, expected item labels, recovered cells, and reason-coded blanks.\n2. **Define source versioning before canonical release**: preserve every bulletin revision while choosing one effective value for each source-date × item × market × unit grain.\n3. **Map staging labels to canonical dimensions** and promote only validated, version-resolved rows into `price_observation`.\n4. **Broaden the regression corpus** with scanned/image PDFs, older templates, inferred-column layouts, and deliberately unrelated documents to exercise fallback and rejection paths.\n5. **Expose these controls in workflow monitoring**: completeness score, parser strategy, revision count, mapping status, and rerun history.", layout: "full", sourceId: "validation-source" },
      { id: "questions", type: "markdown", body: "## Further Questions\n\n- Should a later bulletin always supersede an earlier value for the same source date, or should revisions require manual review?\n- What minimum market/item coverage constitutes a complete bulletin for each known template family?\n- Which canonical taxonomy should merge source spellings such as item and market variants?\n- Should price alerts operate on range midpoint, minimum, maximum, or a separately published modal price when available?", layout: "full", sourceId: "validation-source" },
      { id: "caveats", type: "markdown", body: "## Caveats and Assumptions\n\n- The cohort is random within recent archived documents but excludes previously successful runs; it covers 120 of 133 eligible publications and is therefore close to a census of that window.\n- All sampled PDFs used `labelled_market_date_grid`; this report does not claim equivalent reliability for scanned PDFs or unrelated document types.\n- The database retains all 26,893 observations as `unmapped` staging rows. The deduplicated 26,840-row analytical view exists only for this report.\n- 5,521 observations carry a source date different from the publication date because some market columns report an earlier date.\n- Price movement uses the midpoint of a published range and is not volume weighted. First/last periods are 14 available observations, not fixed calendar weeks.\n- Coverage gaps can be genuine bulletin omissions, market schedules, or extraction gaps; a completeness model is needed to distinguish them.", layout: "full", sourceId: "validation-source" },
    ],
  },
  snapshot: {
    version: 1,
    generatedAt,
    status: "ready",
    datasets: {
      summary: [{
        selected_documents: summary.selected_documents,
        success_rate: summary.success_rate,
        stored_observations: summary.stored_observations,
        invalid_observations: summary.invalid_observations,
      }],
      monthly_quality: analysis.monthly_quality,
      price_trend: analysis.price_trend,
      directional_extremes: analysis.directional_extremes,
      market_coverage: analysis.market_coverage,
      volatility: analysis.volatility,
      document_extremes: analysis.document_extremes,
    },
  },
};

const outputPath = resolve(reportRoot, "report-artifact.json");
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(outputPath);
