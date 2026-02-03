export type FrontMatter = {
  title?: string;
  slug?: string;
  order?: number;
  tags?: string[];
  layout?: string;
  [key: string]: unknown;
};

export type PageNode = {
  type: "page";
  title: string;
  slug: string;
  path: string;
  filePath: string;
  order: number;
  meta: FrontMatter;
};

export type SectionNode = {
  type: "section";
  title: string;
  slug: string;
  path: string;
  dirPath: string;
  order: number;
  indexPage?: PageNode;
  children: Array<SectionNode | PageNode>;
  meta?: FrontMatter;
};

export type RouteEntry = {
  urlPath: string;
  node: PageNode;
};
