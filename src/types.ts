export type Role = 'author' | 'reviewer' | 'editor'
export type ParagraphStatus = 'open' | 'accepted' | 'locked'
export type CommentStatus = 'open' | 'accepted' | 'rejected' | 'merged'
export type CommentType = 'comment' | 'suggestion'

export interface Reply {
  id: string
  author: string
  role: Role
  body: string
  createdAt: number
}

export interface Comment {
  id: string
  paragraphId: string
  author: string
  role: Role
  type: CommentType
  quote: string
  body: string
  suggestion?: string
  status: CommentStatus
  replies: Reply[]
  createdAt: number
  mergedInto?: string
}

export interface Paragraph {
  id: string
  section: string
  number: string
  text: string
  original: string
  status: ParagraphStatus
  highlighted: boolean
}

export interface Version {
  id: string
  label: string
  createdAt: number
  paragraphs: Paragraph[]
}

/** 待提交队列中的改动种类：段落正文、段落锁定、批注、回复、意见合并 */
export type QueueKind = 'paragraph-edit' | 'paragraph-lock' | 'comment-add' | 'comment-reply' | 'comment-merge'

/**
 * queued    —— 离线攒下，等待联网后对账
 * sending   —— 正在与服务端核对（中途崩溃后重载会回退为 queued 重试）
 * failed    —— 网络/服务端错误，内容留在队列里，只重试这一类
 * blocked   —— 服务端拒绝（段落被编辑锁定 / 意见已被合并），本地改动退回队列
 * conflict  —— 两边都改了同一段，等作者挑选本页或远端版本
 * sent      —— 已与远端完成对账
 */
export type QueueStatus = 'queued' | 'sending' | 'failed' | 'blocked' | 'conflict' | 'sent'

export type BlockReason = 'paragraph-locked' | 'comment-merged'

export interface QueuedChange {
  id: string
  kind: QueueKind
  status: QueueStatus
  createdAt: number
  updatedAt: number
  author: string
  role: Role
  attempts: number
  lastError?: string
  blockReason?: BlockReason
  /** 服务端拒绝时的说明（如“意见已由编辑合并到 c-01”） */
  blockDetail?: string
  /** paragraph-edit / paragraph-lock */
  paragraphId?: string
  text?: string
  locked?: boolean
  /** 生成该条目时本地认定的远端修订号，对账时用来判断两边是否都动过 */
  baseRevision?: number
  /** 生成该条目时的远端正文修订号；锁定/解锁不推进它 */
  baseContentRevision?: number
  /** paragraph-edit 冲突后，服务端返回的版本信息 */
  remoteText?: string
  remoteAuthor?: string
  remoteRevision?: number
  remoteContentRevision?: number
  /** comment-add */
  comment?: Omit<Comment, 'id'>
  /** comment-reply */
  commentId?: string
  reply?: Omit<Reply, 'id'>
  /** comment-merge */
  targetCommentId?: string
}

/** 作者挑版本后，落选的那版存进存档，随时可以找回 */
export interface ShelvedVersion {
  id: string
  kind: 'paragraph-edit'
  paragraphId: string
  paragraphNumber: string
  text: string
  source: 'local' | 'remote'
  author: string
  createdAt: number
}

export interface RemoteCommentRef {
  status: CommentStatus
  mergedInto?: string
}

export interface RemoteParagraphRef {
  text: string
  status: ParagraphStatus
  /** 段落任意状态的修订号（含锁定/解锁） */
  revision: number
  /** 只在正文内容变化时推进，用来判断两边是否真的改过同一段文字 */
  contentRevision: number
  editor: string
}

/** 服务端逐段对账的返回 */
export type PushOutcome =
  | { result: 'sent'; revision: number; contentRevision?: number }
  | { result: 'conflict'; remoteText: string; remoteAuthor: string; remoteRevision: number; remoteContentRevision: number }
  | { result: 'blocked'; reason: BlockReason; detail: string }

export interface SyncSummary {
  sent: number
  failed: number
  blocked: number
  conflicts: number
  pulled: number
}
