import type {
  CheckpointArticle,
  CheckpointScoredArticle,
  CheckpointTaggedArticle,
} from "@newsletter/shared";
import { ResponsiveList } from "@/components/domain-list";
import { InspectExternalLink } from "@/components/runs/inspect-external-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatOperatorDate } from "@/lib/format-operator-datetime";

export function formatPhasePublished(date: Date): string {
  return formatOperatorDate(date.toISOString());
}

function articleRowKey(
  article: Pick<CheckpointArticle, "link" | "published">,
  index: number,
): string {
  return `${article.link}\0${article.published.toISOString()}\0${index}`;
}

function TruncatedText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className ?? "block max-w-[240px] truncate"} title={text}>
      {text}
    </span>
  );
}

function formatTags(tags: string[]): string {
  return tags.join(", ");
}

type BasicListProps = {
  articles: CheckpointArticle[];
};

/** Fetched / Scraped article list — Title, Source, Published, Link. */
export function InspectBasicArticleList({ articles }: BasicListProps) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Published</TableHead>
          <TableHead>Link</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {articles.map((article, index) => (
          <TableRow key={articleRowKey(article, index)}>
            <TableCell className="font-medium">
              <TruncatedText text={article.title} />
            </TableCell>
            <TableCell>{article.source}</TableCell>
            <TableCell>{formatPhasePublished(article.published)}</TableCell>
            <TableCell>
              <InspectExternalLink href={article.link} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const cards = (
    <>
      {articles.map((article, index) => (
        <Card key={articleRowKey(article, index)}>
          <CardHeader className="gap-2">
            <CardTitle className="text-base break-words" title={article.title}>
              {article.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Source: </span>
              <span>{article.source}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Published: </span>
              <span>{formatPhasePublished(article.published)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Link: </span>
              <InspectExternalLink href={article.link} />
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );

  return <ResponsiveList table={table} cards={cards} />;
}

type TaggedListProps = {
  articles: CheckpointTaggedArticle[];
};

/** Tagged article list — Title, Source, Tags, Published, Link. */
export function InspectTaggedArticleList({ articles }: TaggedListProps) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Tags</TableHead>
          <TableHead>Published</TableHead>
          <TableHead>Link</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {articles.map((article, index) => {
          const tags = formatTags(article.tags);
          return (
            <TableRow key={articleRowKey(article, index)}>
              <TableCell className="font-medium">
                <TruncatedText text={article.title} />
              </TableCell>
              <TableCell>{article.source}</TableCell>
              <TableCell>
                <TruncatedText text={tags} className="block max-w-[200px] truncate" />
              </TableCell>
              <TableCell>{formatPhasePublished(article.published)}</TableCell>
              <TableCell>
                <InspectExternalLink href={article.link} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const cards = (
    <>
      {articles.map((article, index) => {
        const tags = formatTags(article.tags);
        return (
          <Card key={articleRowKey(article, index)}>
            <CardHeader className="gap-2">
              <CardTitle className="text-base break-words" title={article.title}>
                {article.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Source: </span>
                <span>{article.source}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Tags: </span>
                <span className="break-words" title={tags}>
                  {tags}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Published: </span>
                <span>{formatPhasePublished(article.published)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Link: </span>
                <InspectExternalLink href={article.link} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </>
  );

  return <ResponsiveList table={table} cards={cards} />;
}

type ScoredListProps = {
  articles: CheckpointScoredArticle[];
};

/**
 * Scored article list — Title, Score, Source, Tags, Published, Link.
 * Caller is responsible for score-descending sort.
 */
export function InspectScoredArticleList({ articles }: ScoredListProps) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Score</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Tags</TableHead>
          <TableHead>Published</TableHead>
          <TableHead>Link</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {articles.map((article, index) => {
          const tags = formatTags(article.tags);
          return (
            <TableRow key={articleRowKey(article, index)}>
              <TableCell className="font-medium">
                <TruncatedText text={article.title} />
              </TableCell>
              <TableCell>{String(article.score)}</TableCell>
              <TableCell>{article.source}</TableCell>
              <TableCell>
                <TruncatedText text={tags} className="block max-w-[200px] truncate" />
              </TableCell>
              <TableCell>{formatPhasePublished(article.published)}</TableCell>
              <TableCell>
                <InspectExternalLink href={article.link} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const cards = (
    <>
      {articles.map((article, index) => {
        const tags = formatTags(article.tags);
        return (
          <Card key={articleRowKey(article, index)}>
            <CardHeader className="gap-2">
              <CardTitle className="text-base break-words" title={article.title}>
                {article.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Score: </span>
                <span>{String(article.score)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Source: </span>
                <span>{article.source}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Tags: </span>
                <span className="break-words" title={tags}>
                  {tags}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Published: </span>
                <span>{formatPhasePublished(article.published)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Link: </span>
                <InspectExternalLink href={article.link} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </>
  );

  return <ResponsiveList table={table} cards={cards} />;
}

/** Stable score-descending sort for scored articles. */
export function sortScoredDescending(
  articles: CheckpointScoredArticle[],
): CheckpointScoredArticle[] {
  return articles
    .map((article, index) => ({ article, index }))
    .sort((a, b) => {
      if (b.article.score !== a.article.score) {
        return b.article.score - a.article.score;
      }
      return a.index - b.index;
    })
    .map(({ article }) => article);
}
