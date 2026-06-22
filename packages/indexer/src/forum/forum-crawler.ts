import type { ForumPost } from "@cesium-nexus/shared";

export class ForumCrawlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForumCrawlError";
  }
}

export interface CrawlForumOptions {
  baseUrl?: string;
  maxPages?: number;
  minReplies?: number;
  minViews?: number;
  category?: string;
}

export interface CrawlForumResult {
  posts: ForumPost[];
  totalPages: number;
  filtered: number;
}

interface DiscourseTopicListItem {
  id: number;
  title: string;
  views: number;
  posts_count: number;
  has_accepted_answer?: boolean;
  tags?: string[];
  created_at: string;
  last_posted_at?: string;
  slug: string;
}

interface DiscourseTopicPost {
  cooked: string;
  username: string;
}

interface DiscourseTopicDetail {
  id: number;
  post_stream?: { posts: DiscourseTopicPost[] };
}

interface DiscourseLatestResponse {
  topic_list?: { topics: DiscourseTopicListItem[] };
}

export function computeForumQualityScore(
  post: Partial<ForumPost>,
): number {
  let score = 0;
  if (post.hasSolution) score += 0.9;
  score += Math.min((post.viewsCount ?? 0) / 1000, 0.1);
  return Math.round(score * 1000) / 1000;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDiscourseTopic(
  topic: DiscourseTopicListItem,
  detail: DiscourseTopicDetail | null,
  baseUrl: string,
): ForumPost {
  let body = "";
  let author = "";

  if (detail?.post_stream?.posts?.[0]) {
    const firstPost = detail.post_stream.posts[0];
    body = stripHtml(firstPost.cooked);
    author = firstPost.username;
  }

  return {
    id: topic.id,
    topicId: topic.id,
    title: topic.title,
    body,
    author,
    repliesCount: Math.max(0, (topic.posts_count ?? 1) - 1),
    viewsCount: topic.views ?? 0,
    hasSolution: topic.has_accepted_answer === true,
    tags: topic.tags ?? [],
    createdAt: topic.created_at ?? "",
    updatedAt: topic.last_posted_at ?? topic.created_at ?? "",
    url: `${baseUrl}/t/${topic.slug}/${topic.id}`,
    qualityScore: 0,
  };
}

export async function crawlForum(
  opts: CrawlForumOptions = {},
): Promise<CrawlForumResult> {
  const {
    baseUrl = "https://community.cesium.com",
    maxPages = 10,
    minReplies = 2,
    minViews = 200,
  } = opts;

  const posts: ForumPost[] = [];
  let filtered = 0;
  let totalPages = 0;

  for (let page = 0; page < maxPages; page++) {
    totalPages++;
    const listUrl = `${baseUrl}/latest.json?page=${page}`;

    let listData: DiscourseLatestResponse;
    try {
      const response = await fetch(listUrl, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) break;
      listData = (await response.json()) as DiscourseLatestResponse;
    } catch {
      break;
    }

    const topics = listData.topic_list?.topics ?? [];
    if (topics.length === 0) break;

    for (const topic of topics) {
      const replies = Math.max(0, (topic.posts_count ?? 1) - 1);
      if (replies < minReplies && topic.views < minViews) {
        filtered++;
        continue;
      }

      let detail: DiscourseTopicDetail | null = null;
      try {
        const detailUrl = `${baseUrl}/t/${topic.id}.json`;
        const detailResponse = await fetch(detailUrl, {
          headers: { Accept: "application/json" },
        });
        if (detailResponse.ok) {
          detail = (await detailResponse.json()) as DiscourseTopicDetail;
        }
      } catch {
        // detail fetch failed, still create post with limited info
      }

      const post = parseDiscourseTopic(topic, detail, baseUrl);
      post.qualityScore = computeForumQualityScore(post);
      posts.push(post);
    }
  }

  return { posts, totalPages, filtered };
}
