export type Role = 'author' | 'reviewer' | 'editor'
export type ParagraphStatus = 'open' | 'accepted' | 'locked'
export type CommentStatus = 'open' | 'accepted' | 'rejected' | 'merged'
export type CommentType = 'comment' | 'suggestion'

/** 待提交队列条目类型：段落、批注、回复 */
export type QueueKind = 'paragraph' | 'comment' | 'reply'
/**
 * 队列条目状态：
 * - pending 待提交（含新提交与被退回后重新编辑的）
 * - syncing 同步中
 * - conflict 两边都改了同一段落，等待作者选版
 * - rejected 被远端退回（段落被锁 / 远端已合并他人意见），留在队列
 * - failed 网络或服务端失败，队列保留，可重试
 * - succeeded 已对账成功
 */
export type QueueItemStatus = 'pending' | 'syncing' | 'conflict' | 'rejected' | 'failed' | 'succeeded'
export type RejectReason = 'locked' | 'already-merged'
/** 批注/回复在本地队列中的同步状态 */
export type SyncStatus = 'pending' | 'failed' | 'rejected'

export interface Reply {
  id: string
  author: string
  role: Role
  body: string
  createdAt: number
  syncStatus?: SyncStatus
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
  syncStatus?: SyncStatus
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

export interface EditConflict {
  id: string
  paragraphId: string
  localText: string
  remoteText: string
  localAuthor: string
  remoteAuthor: string
  detectedAt: number
  /** 关联的队列条目 id，对账成功后据此回写队列状态 */
  clientItemId?: string
  /** 三段对账的基准文本（开始编辑时的版本） */
  baseText?: string
  /** 稍后处理：收起提醒卡片，但队列中仍可重新打开 */
  dismissed?: boolean
}

export interface QueueItemPayload {
  /** 段落编辑：开始编辑时的基准文本 */
  baseText?: string
  /** 段落编辑：本页文本 */
  localText?: string
  /** 批注：本地批注 id（服务端据此幂等去重） */
  localId?: string
  commentType?: CommentType
  quote?: string
  body?: string
  suggestion?: string
  /** 回复：本地回复 id */
  replyId?: string
  /** 回复：被回复的批注 id */
  commentId?: string
  /** 回复：所属段落 id（供服务端校验锁定状态） */
  paragraphId?: string
  author: string
  role: Role
}

export interface QueueItem {
  id: string
  kind: QueueKind
  status: QueueItemStatus
  paragraphId: string
  createdAt: number
  attempts: number
  lastError?: string
  rejectReason?: RejectReason
  payload: QueueItemPayload
}

/** 落选版本存档：冲突中未被采用的一版，可随时找回恢复 */
export interface ArchivedVersion {
  id: string
  paragraphId: string
  text: string
  source: 'local' | 'remote'
  /** conflict-local：本页版本落选；conflict-remote：远端版本落选 */
  reason: 'conflict-local' | 'conflict-remote'
  conflictId?: string
  archivedAt: number
}

export interface HistorySnapshot {
  paragraphs: Paragraph[]
  comments: Comment[]
  versions: Version[]
}
