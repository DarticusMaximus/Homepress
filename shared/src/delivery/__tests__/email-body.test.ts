import { describe, it, expect } from "vitest";

import { draftMarkdownToEmailHtml, draftMarkdownToEmailText } from "../email-body";

/**
 * Parity note (S1/N1): email (`sendIssueEmail`), RSS snapshot `htmlBody`
 * (`publishIssueToRss`), and HTML export (`prepareIssueExport`) all call
 * `draftMarkdownToEmailHtml` unchanged. Sanitizing inside this helper keeps
 * those three outputs byte-equal for the same markdown — do not fork
 * per-channel HTML conversion.
 */
describe("draftMarkdownToEmailHtml", () => {
  it("renders heading, paragraph, and link from markdown", () => {
    const markdown = `# Hello Digest

This is a paragraph with a [link](https://example.com/article).
`;
    const html = draftMarkdownToEmailHtml(markdown);

    expect(html).toMatch(/<h1[^>]*>\s*Hello Digest\s*<\/h1>/i);
    expect(html).toContain("This is a paragraph");
    expect(html).toMatch(
      /<a[^>]*href="https:\/\/example\.com\/article"[^>]*>\s*link\s*<\/a>/i,
    );
  });

  it("renders GFM list items and bold/italic emphasis", () => {
    const markdown = `- First item with **bold**
- Second item with *italic*
`;
    const html = draftMarkdownToEmailHtml(markdown);

    expect(html).toMatch(/<li[^>]*>[\s\S]*First item/i);
    expect(html).toMatch(/<li[^>]*>[\s\S]*Second item/i);
    expect(html).toMatch(/<(strong|b)>\s*bold\s*<\/\1>/i);
    expect(html).toMatch(/<(em|i)>\s*italic\s*<\/\1>/i);
  });

  it("renders GFM fenced code and tables", () => {
    const markdown = `\`\`\`ts
const x = 1;
\`\`\`

| A | B |
| - | - |
| 1 | 2 |
`;
    const html = draftMarkdownToEmailHtml(markdown);

    expect(html).toMatch(/<pre[^>]*>[\s\S]*<code[^>]*>[\s\S]*const x = 1/i);
    expect(html).toMatch(/<table[\s\S]*<th[^>]*>\s*A\s*<\/th>/i);
    expect(html).toMatch(/<td[^>]*>\s*1\s*<\/td>/i);
  });

  it("strips raw <script> tags from adversarial markdown", () => {
    const markdown = `Hello

<script>alert("xss")</script>

More text
`;
    const html = draftMarkdownToEmailHtml(markdown);

    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/alert\s*\(/i);
    expect(html).toContain("Hello");
    expect(html).toContain("More text");
  });

  it("strips inline event-handler attributes", () => {
    const markdown = `<img src="https://example.com/ok.png" onerror="alert(1)" alt="x">

<p onclick="alert(2)">click me</p>
`;
    const html = draftMarkdownToEmailHtml(markdown);

    expect(html).not.toMatch(/\son\w+\s*=/i);
    expect(html).not.toMatch(/alert\s*\(/i);
  });

  it("neutralizes javascript: and data: URL schemes on links and images", () => {
    // Use Marked-parseable URLs (no raw commas/angle brackets that break link parsing).
    const markdown = `[evil](javascript:alert(1))

[payload](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)

![bad](javascript:alert(2))

![data](data:image/png;base64,iVBORw0KGgo=)

[safe](https://example.com/ok)
`;
    const html = draftMarkdownToEmailHtml(markdown);

    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/data:/i);
    expect(html).toMatch(
      /<a[^>]*href="https:\/\/example\.com\/ok"[^>]*>\s*safe\s*<\/a>/i,
    );
  });

  it("keeps http, https, and mailto links", () => {
    const markdown = `[web](https://example.com)

[site](http://example.com)

[mail](mailto:ops@example.com)
`;
    const html = draftMarkdownToEmailHtml(markdown);

    expect(html).toMatch(/href="https:\/\/example\.com"/i);
    expect(html).toMatch(/href="http:\/\/example\.com"/i);
    expect(html).toMatch(/href="mailto:ops@example\.com"/i);
  });
});

describe("draftMarkdownToEmailText", () => {
  it("returns markdown with newlines normalized and does not strip to bare text", () => {
    const markdown =
      "# Title\r\n\r\nA paragraph with **bold** and a [link](https://example.com).\r\n";
    const text = draftMarkdownToEmailText(markdown);

    expect(text).toBe(
      "# Title\n\nA paragraph with **bold** and a [link](https://example.com).\n",
    );
    expect(text).toContain("**bold**");
    expect(text).toContain("[link](https://example.com)");
    expect(text).not.toContain("\r");
  });
});
