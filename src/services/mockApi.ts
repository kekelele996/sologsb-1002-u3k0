import { baseComments, baseParagraphs } from '../data/seed'
import type { Comment, CommentStatus, Paragraph, ParagraphStatus, PushOutcome, QueuedChange } from '../types'

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const REMOTE_KEY = 'sologsb-1002-remote-v1'

interface RemoteState {
  paragraphs: Record<string, { text: string; status: ParagraphStatus; revision: number; contentRevision: number; editor: string }>
  comments: Record<string, { status: CommentStatus; mergedInto?: string; replies: number }>
  /** 已处理过的队列条目（回复/合并等），保证响应丢失后重试不会在服务端重复落库 */
  appliedChanges: string[]
}

const buildInitialRemote = (): RemoteState => ({
  paragraphs: Object.fromEntries(baseParagraphs.map((paragraph) => [paragraph.id, { text: paragraph.text, status: paragraph.status, revision: 1, contentRevision: 1, editor: '系统' }])),
  comments: Object.fromEntries(baseComments.map((comment) => [comment.id, { status: comment.status, mergedInto: comment.mergedInto, replies: comment.replies.length }])),
  appliedChanges: [],
})

const loadRemote = (): RemoteState => {
  try {
    const raw = localStorage.getItem(REMOTE_KEY)
    if (raw) return JSON.parse(raw) as RemoteState
  } catch {
    // 存档损坏时回退到初始远端
  }
  const initial = buildInitialRemote()
  localStorage.setItem(REMOTE_KEY, JSON.stringify(initial))
  return initial
}

let remote: RemoteState = typeof localStorage !== 'undefined' ? loadRemote() : buildInitialRemote()
let online = true
let weakNetwork = false
let requestCounter = 0

const persistRemote = () => {
  try {
    localStorage.setItem(REMOTE_KEY, JSON.stringify(remote))
  } catch {
    // 存储不可用时仅保留内存态
  }
}

/** 弱网下每 3 次请求随机失败 1 次，用来演示“队列留着重试，只补没送成功的段落” */
const networkFailure = (): string | null => {
  if (!online) return '当前处于断网状态，改动暂存在本地队列'
  requestCounter += 1
  if (weakNetwork && requestCounter % 3 === 0) return '弱网：服务端响应超时，请稍后重试'
  return null
}

export const isRemoteOnline = () => online
export const isWeakNetwork = () => weakNetwork
export const setRemoteOnline = (value: boolean) => { online = value }
export const setWeakNetwork = (value: boolean) => {
  weakNetwork = value
  requestCounter = 0
}

export const resetRemote = () => {
  remote = buildInitialRemote()
  persistRemote()
}

/** 审阅服务端快照，用于恢复网络后逐段对账 */
export interface RemoteSnapshot {
  paragraphs: Record<string, RemoteState['paragraphs'][string]>
  comments: Record<string, RemoteState['comments'][string]>
}
export const fetchRemoteSnapshot = async (): Promise<RemoteSnapshot> => {
  const failure = networkFailure()
  await wait(320)
  if (failure) throw new Error(failure)
  return {
    paragraphs: JSON.parse(JSON.stringify(remote.paragraphs)),
    comments: JSON.parse(JSON.stringify(remote.comments)),
  }
}

/** 把队列中的一个改动逐段送到审阅服务对账 */
export const pushQueuedChange = async (change: QueuedChange): Promise<PushOutcome> => {
  const failure = networkFailure()
  await wait(520)
  if (failure) throw new Error(failure)

  if (change.kind === 'paragraph-edit') {
    const ref = remote.paragraphs[change.paragraphId ?? '']
    if (!ref) return { result: 'blocked', reason: 'paragraph-locked', detail: '服务端已删除该段落' }
    if (ref.status === 'locked') return { result: 'blocked', reason: 'paragraph-locked', detail: `编辑已锁定该段落（${ref.editor}）` }
    // 正文修订号对不上，说明离线期间别人也改过这一段文字（锁定/解锁不算）
    const baseContent = change.baseContentRevision
    const contentChanged = baseContent !== undefined ? ref.contentRevision > baseContent : change.baseRevision !== undefined && ref.revision > change.baseRevision
    if (contentChanged) {
      return { result: 'conflict', remoteText: ref.text, remoteAuthor: ref.editor, remoteRevision: ref.revision, remoteContentRevision: ref.contentRevision }
    }
    ref.text = change.text ?? ref.text
    ref.revision += 1
    ref.contentRevision += 1
    ref.editor = change.author
    persistRemote()
    return { result: 'sent', revision: ref.revision, contentRevision: ref.contentRevision }
  }

  if (change.kind === 'paragraph-lock') {
    const ref = remote.paragraphs[change.paragraphId ?? '']
    if (!ref) return { result: 'blocked', reason: 'paragraph-locked', detail: '服务端已删除该段落' }
    ref.status = change.locked ? 'locked' : 'accepted'
    ref.revision += 1
    ref.editor = change.author
    persistRemote()
    return { result: 'sent', revision: ref.revision, contentRevision: ref.contentRevision }
  }

  if (change.kind === 'comment-add') {
    // 幂等：重试时同一条本地批注不会在服务端重复落库
    if (!remote.comments[change.id]) {
      remote.comments[change.id] = { status: 'open', replies: 0 }
      persistRemote()
    }
    return { result: 'sent', revision: 1 }
  }

  if (change.kind === 'comment-reply') {
    const ref = change.commentId ? remote.comments[change.commentId] : undefined
    if (!ref) return { result: 'blocked', reason: 'comment-merged', detail: '服务端找不到对应批注' }
    // 幂等：响应丢失后的重试直接返回成功，不重复增加回复
    if (remote.appliedChanges.includes(change.id)) return { result: 'sent', revision: ref.replies }
    if (ref.status === 'merged') return { result: 'blocked', reason: 'comment-merged', detail: `该意见已由编辑合并到 ${ref.mergedInto ?? '其他意见'}，回复退回本地队列` }
    ref.replies += 1
    remote.appliedChanges.push(change.id)
    persistRemote()
    return { result: 'sent', revision: ref.replies }
  }

  // comment-merge
  const ref = change.commentId ? remote.comments[change.commentId] : undefined
  const target = change.targetCommentId ? remote.comments[change.targetCommentId] : undefined
  if (!ref) return { result: 'blocked', reason: 'comment-merged', detail: '被合并的意见在服务端不存在' }
  if (remote.appliedChanges.includes(change.id)) return { result: 'sent', revision: 1 }
  if (ref.status === 'merged') return { result: 'blocked', reason: 'comment-merged', detail: `该意见已经合并到 ${ref.mergedInto ?? '其他意见'}` }
  if (!target) return { result: 'blocked', reason: 'comment-merged', detail: '合并目标意见已不存在' }
  ref.status = 'merged'
  ref.mergedInto = change.targetCommentId
  remote.appliedChanges.push(change.id)
  persistRemote()
  return { result: 'sent', revision: 1 }
}

/* —— 模拟“别人”在审阅服务上的动作，用于演示对账 —— */

const touchParagraph = (paragraphId: string, produce: (ref: RemoteState['paragraphs'][string]) => void, content = false) => {
  const ref = remote.paragraphs[paragraphId]
  if (!ref) return
  produce(ref)
  ref.revision += 1
  if (content) ref.contentRevision += 1
  persistRemote()
}

export const simulateRemoteEdit = (paragraph: Paragraph, author = '协作者 · 王教授'): string => {
  const next = paragraph.text.includes('然而')
    ? paragraph.text.replace('然而', '但是')
    : `${paragraph.text.replace(/。$/, '')}。远端补充：该结论仅适用于本次样本。`
  touchParagraph(paragraph.id, (ref) => { ref.text = next; ref.editor = author }, true)
  return next
}

export const simulateRemoteLock = (paragraph: Paragraph, locked: boolean, editor = '编辑 · 周编审') => {
  touchParagraph(paragraph.id, (ref) => { ref.status = locked ? 'locked' : 'accepted'; ref.editor = editor }, false)
}

export const simulateRemoteMerge = (comment: Comment, targetId: string) => {
  const ref = remote.comments[comment.id] ?? { status: 'open' as CommentStatus, replies: 0 }
  ref.status = 'merged'
  ref.mergedInto = targetId
  remote.comments[comment.id] = ref
  persistRemote()
}

export const remoteRevisionOf = (paragraphId: string) => remote.paragraphs[paragraphId]?.revision ?? 0
