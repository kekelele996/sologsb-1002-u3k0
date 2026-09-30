import type { CommentType, Paragraph, QueueKind, Role } from '../types'

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export interface RemotePatch {
  accepted: boolean
  paragraphId: string
  remoteText: string
  remoteAuthor: string
  serverRevision: number
}

export const submitRemotePatch = async (paragraph: Paragraph): Promise<RemotePatch> => {
  await wait(650)
  const remoteText = paragraph.text.includes('然而')
    ? paragraph.text.replace('然而', '但是')
    : `${paragraph.text.replace(/。$/, '')}。作者补充：该结论仅适用于本次样本。`
  const remote = remoteParagraphs.get(paragraph.id)
  if (remote) {
    remote.text = remoteText
    remote.revision += 1
  }
  return {
    accepted: true,
    paragraphId: paragraph.id,
    remoteText,
    remoteAuthor: '协作者 · 王教授',
    serverRevision: remote?.revision ?? Math.floor(Date.now() / 1000),
  }
}

export interface SyncInputItem {
  clientItemId: string
  kind: QueueKind
  paragraphId: string
  baseText?: string
  localText?: string
  localId?: string
  commentType?: CommentType
  quote?: string
  body?: string
  suggestion?: string
  replyId?: string
  commentId?: string
  author: string
  role: Role
  attempts: number
}

export type SyncResult =
  | { status: 'accepted'; clientItemId: string; serverRevision: number }
  | { status: 'conflict'; clientItemId: string; remoteText: string; remoteAuthor: string }
  | { status: 'rejected'; clientItemId: string; reason: 'locked' | 'already-merged'; message: string }
  | { status: 'failed'; clientItemId: string; message: string }

interface RemoteParagraph {
  text: string
  locked: boolean
  /** 远端已合并他人意见（编辑合并重复意见后推进的版本） */
  merged: boolean
  revision: number
}

interface RemoteComment {
  paragraphId: string
  status: 'open' | 'merged'
}

/** 远端审阅服务的内存状态（演示用，刷新页面后随示例数据重置） */
let remoteParagraphs = new Map<string, RemoteParagraph>()
let remoteComments = new Map<string, RemoteComment>()
/** 已成功应用的客户端条目 id，用于断网重试时幂等去重 */
const appliedClientItems = new Map<string, number>()
let networkOnline = true
let failRandom = false

const defaultSeed = (): Paragraph[] => [
  { id: 'p-01', section: '摘要', number: '1.', text: '开源软件供应链的稳定性不仅取决于代码质量，也取决于维护者能否持续识别并回应社区需求。', original: '', status: 'open', highlighted: false },
  { id: 'p-02', section: '1 引言', number: '2.', text: '近年来，大型语言模型被广泛用于代码生成与缺陷定位，但其在真实维护工作流中的影响仍缺少系统证据。', original: '', status: 'open', highlighted: false },
  { id: 'p-03', section: '1 引言', number: '3.', text: '本文收集 12 个活跃开源项目连续 18 个月的议题记录，并访谈 26 位核心维护者。', original: '', status: 'open', highlighted: false },
  { id: 'p-04', section: '2 方法', number: '4.', text: '我们采用混合研究方法，将议题生命周期划分为响应、评审与合并三个阶段。编码过程由两名研究者独立完成。', original: '', status: 'open', highlighted: false },
  { id: 'p-05', section: '2 方法', number: '5.', text: '当编码结果不一致时，研究者通过讨论达成一致；若仍有分歧，则邀请第三位研究者裁决。', original: '', status: 'open', highlighted: false },
  { id: 'p-06', section: '3 结果', number: '6.', text: '初步结果显示，辅助工具缩短了首次响应时间，但没有显著降低维护者处理复杂议题的认知负担。', original: '', status: 'open', highlighted: false },
  { id: 'p-07', section: '3 结果', number: '7.', text: '在高活跃度项目中，维护者更关注建议是否可验证，而非建议生成速度。', original: '', status: 'open', highlighted: false },
]

/** 重置远端服务状态；可传入当前段落作为种子 */
export const resetMockServer = (paragraphs?: Paragraph[]) => {
  const seed = paragraphs?.length ? paragraphs : defaultSeed()
  remoteParagraphs = new Map(seed.map((paragraph) => [paragraph.id, {
    text: paragraph.text,
    // p-03 远端已被编辑锁定：本地改动应被退回
    locked: paragraph.id === 'p-03',
    // p-04 远端已合并过他人意见：本地改动应被退回重基
    merged: paragraph.id === 'p-04',
    revision: 1,
  }]))
  // p-06 远端已有协作者改过：本地提交会触发两边版本冲突
  const remoteP06 = remoteParagraphs.get('p-06')
  if (remoteP06) {
    remoteP06.text = `${remoteP06.text}（协作者补充：建议补充效应量与统计检验报告。）`
    remoteP06.revision = 2
  }
  // c-05 批注已被编辑合并：回复应被退回
  remoteComments = new Map([['c-05', { paragraphId: 'p-05', status: 'merged' }]])
  appliedClientItems.clear()
}

export const setNetworkOnline = (online: boolean) => { networkOnline = online }
export const setMockFailRandom = (value: boolean) => { failRandom = value }

const hashCode = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 997
  }
  return hash
}

/**
 * 与审阅服务逐段对账：队列条目按顺序逐条提交。
 * 单条失败不影响其他条目；网络整体不可用时抛出异常，由调用方保留队列待重试。
 */
export const syncItems = async (items: SyncInputItem[]): Promise<SyncResult[]> => {
  if (!networkOnline) throw new Error('NETWORK_OFFLINE')
  const results: SyncResult[] = []
  for (const item of items) {
    await wait(280)
    // 幂等：同一条目重试时不重复应用
    if (appliedClientItems.has(item.clientItemId)) {
      results.push({ status: 'accepted', clientItemId: item.clientItemId, serverRevision: appliedClientItems.get(item.clientItemId) as number })
      continue
    }
    if (failRandom && (hashCode(item.clientItemId) + item.attempts) % 5 === 0) {
      results.push({ status: 'failed', clientItemId: item.clientItemId, message: '服务端 500：对账失败，队列已保留' })
      continue
    }

    let result: SyncResult
    if (item.kind === 'paragraph') {
      const remote = remoteParagraphs.get(item.paragraphId)
      if (!remote) {
        result = { status: 'rejected', clientItemId: item.clientItemId, reason: 'already-merged', message: '远端段落不存在，可能已被合并或删除' }
      } else if (remote.locked) {
        result = { status: 'rejected', clientItemId: item.clientItemId, reason: 'locked', message: '段落已被编辑锁定，本地改动已退回队列' }
      } else if (remote.merged) {
        result = { status: 'rejected', clientItemId: item.clientItemId, reason: 'already-merged', message: '远端已合并他人意见，请基于最新版本修改后重新提交' }
      } else if (item.baseText !== undefined && item.baseText !== remote.text) {
        // 三段对账：基准版本与远端当前版本不一致 → 两边都改过，保留两版交作者选择
        result = { status: 'conflict', clientItemId: item.clientItemId, remoteText: remote.text, remoteAuthor: '协作者 · 王教授' }
      } else {
        remote.text = item.localText ?? remote.text
        remote.revision += 1
        appliedClientItems.set(item.clientItemId, remote.revision)
        result = { status: 'accepted', clientItemId: item.clientItemId, serverRevision: remote.revision }
      }
    } else if (item.kind === 'comment') {
      const remote = remoteParagraphs.get(item.paragraphId)
      if (remote?.locked) {
        result = { status: 'rejected', clientItemId: item.clientItemId, reason: 'locked', message: '段落已被编辑锁定，批注已退回队列' }
      } else {
        if (item.localId) remoteComments.set(item.localId, { paragraphId: item.paragraphId, status: 'open' })
        const revision = (remote?.revision ?? 0) + 1
        appliedClientItems.set(item.clientItemId, revision)
        result = { status: 'accepted', clientItemId: item.clientItemId, serverRevision: revision }
      }
    } else {
      const remote = remoteParagraphs.get(item.paragraphId)
      const comment = item.commentId ? remoteComments.get(item.commentId) : undefined
      if (remote?.locked) {
        result = { status: 'rejected', clientItemId: item.clientItemId, reason: 'locked', message: '段落已被编辑锁定，回复已退回队列' }
      } else if (comment?.status === 'merged') {
        result = { status: 'rejected', clientItemId: item.clientItemId, reason: 'already-merged', message: '该意见已被编辑合并，回复已退回队列' }
      } else {
        const revision = (remote?.revision ?? 0) + 1
        appliedClientItems.set(item.clientItemId, revision)
        result = { status: 'accepted', clientItemId: item.clientItemId, serverRevision: revision }
      }
    }
    results.push(result)
  }
  return results
}

/** 作者选定冲突版本后，把结论回写远端，避免下次对账重复冲突 */
export const resolveConflictOnServer = async (paragraphId: string, strategy: 'local' | 'remote', localText?: string) => {
  await wait(200)
  const remote = remoteParagraphs.get(paragraphId)
  if (remote) {
    if (strategy === 'local' && localText !== undefined) remote.text = localText
    remote.merged = false
    remote.revision += 1
  }
}
