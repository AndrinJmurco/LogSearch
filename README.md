# LogSearch

A single-file log explorer prepared for App Foundry's **client-side HTML** stack.
This is a new parser: the existing LogSearch repository had no script to reuse.

## Use the app

Open `index.html` in a current Chrome, Edge, Firefox, or Safari browser, then:

1. Select **Load sample**, choose one or more files, or expand **Paste text**.
2. Search for literal text and filter by severity or source file.
3. Select a message to inspect its complete text, structured fields, and original event.
4. Export the matching events as CSV or JSON. Exports include every matching page.

Loading files, loading the sample, or parsing pasted text replaces the current session.
**Clear logs** removes the loaded events and pasted input from the interface.
The app does not create a saved history or send log content to an application server.

## Deploy to App Foundry

1. Open <https://portal.idp.zenai-apps.com/> and sign in with Zendesk Okta SSO.
2. Start a new application and choose the **client-side HTML** stack/template.
3. Use `LogSearch` as the display name, or `logsearch` if the name field requires a slug.
4. Paste the **complete contents of `index.html`** into the HTML source field.
5. No API keys, database, artifact uploads, Python requirements, or backend are needed.
6. Submit the application using the portal's deployment action. Exact UI labels may vary.
7. Open the resulting app URL after the build completes. Select **Load sample** to
   check that events appear, filter **Error**, inspect an event, and try both exports.

The App Foundry portal's HTML template owns the hosting container and port binding.
This project contains no custom server and does not require a Dockerfile.
Do not upload the source zip to the Dockerfile template: it is an archive of source,
not a container build context.

App Foundry supplies a Gitea repository for ongoing deployments. Keep the app's
`index.html` there when updating it through the platform's GitOps workflow; a
commit in this GitHub repository alone does not trigger App Foundry deployment.

Live deployment and platform authentication are separate from these local source
and parser checks. A running App Foundry URL has not been verified for this version.

## Supported input

| Format | Example / behavior |
| --- | --- |
| JSON Lines / NDJSON | One JSON log object per line, with fields such as `timestamp`, `level`, and `message` / `msg`. |
| JSON array | A complete array of log objects. Rows use record numbers; original object whitespace and source line numbers are not retained. |
| Timestamped text | `2026-11-06T09:00:00Z ERROR Database timed out`, including bracketed timestamps and Python's `logger - LEVEL - message` convention. |
| Apache / Nginx access | Common or combined request logs. HTTP 5xx becomes ERROR; 4xx WARN; other response codes INFO. |
| Syslog text | `Nov  6 09:00:00 host worker[42]: ERROR Job failed`. Missing year/timezone is preserved, not guessed. |
| Plain text | Unrecognized lines stay visible with UNKNOWN severity. Malformed JSON is preserved as text. |

Continuation lines such as indented frames, Python tracebacks, `Caused by:`, and
exception messages are attached to the preceding text event. Blank lines are
skipped; line ranges refer to original input line numbers. JSON Lines objects stay
separate. Continuation heuristics are general purpose and may need adjustment for
your original parser's exact log format.

Aliases: WARNING → WARN, ERR / SEVERE → ERROR, FATAL / EMERGENCY / ALERT → CRITICAL.
Numeric JSON `level` values follow the Pino convention: 10 trace, 20 debug, 30 info,
40 warn, 50 error, 60 fatal. Numeric timestamps are interpreted as epoch seconds
below 100 billion, otherwise as epoch milliseconds. Text timestamps are retained
without timezone conversion or sorting; events remain in source-file order.

## Limits and behavior

- UTF-8 text; no compressed archives or binary input.
- Up to 12 files, 20 MiB of input, 100,000 events, and 200,000 source lines per session.
- If a limit or decoding error occurs, show an error and keep the prior results;
  do not silently truncate the new input.
- Search is case-insensitive literal matching over raw text, source, logger,
  timestamp, and severity. There is no custom regular-expression execution.
- The result table displays 100 events per page.
- Parsing uses a background worker when allowed, with an asynchronous fallback.
- Untrusted messages, fields, and filenames are rendered as text, not HTML.
- CSV cells beginning with formula characters are prefixed with an apostrophe for
  spreadsheet safety. CSV is quoted with CRLF row separators and a UTF-8 BOM.
  JSON retains the parsed values without that CSV transformation.
- Logs are held in the current browser tab only; no localStorage, cookies,
  analytics, database, or log-upload API is used by the application.
- The required App Foundry Tailwind CDN script is included; all application CSS,
  JavaScript, and SVG icons are inline. Styling is also defined in the inline CSS
  so the interface remains usable when the CDN is unavailable. The page does make
  that external script request; it is not a completely offline dependency bundle.

## Validate locally

Node.js 18 or newer; no npm packages are required:

```sh
node --test parser.test.cjs
```

The suite covers timestamps, JSON fields, severity aliases, multiline traces,
access logs, syslog, source boundaries, search, CSV safety, malformed input, input
limits, and independent worker execution. These are parser and source checks;
they do not replace a live browser and App Foundry deployment smoke test.

## Customize for an existing script

The `parser-core` script defines `createLogParser()`. Add format-specific parsing
there, return the same event fields, and add representative fixtures to
`parser.test.cjs`. No original custom script was available when this version was built.

