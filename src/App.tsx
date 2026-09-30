import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiOutlined, ArrowLeftOutlined, BranchesOutlined, CheckOutlined, ClockCircleOutlined,
  CloseOutlined, CloudOutlined, CommentOutlined, DiffOutlined, DeleteOutlined, DisconnectOutlined,
  FileDoneOutlined, FileTextOutlined, HistoryOutlined, InboxOutlined, LockOutlined, MenuFoldOutlined,
  MessageOutlined, PlusOutlined, RedoOutlined, ReloadOutlined, SaveOutlined, SendOutlined, SwapOutlined,
  UndoOutlined, UnlockOutlined,
} from '@ant-design/icons'
import { Alert, Badge, Button, Card, Checkbox, Divider, Drawer, Empty, Input, Modal, Radio, Segmented, Select, Space, Spin, Switch, Tag, Tooltip, message } from 'antd'
import { useReviewStore } from './store/review'
import type { Comment, CommentType, QueuedChange, QueueStatus, Role, ShelvedVersion } from './types'

const roleMeta: Record<Role, { label: string; description: string; color: string }> = {
  author: { label: '作者工作区', description: '编辑正文，逐条接受或拒绝修改建议', color: '#2f6f5e' },
  reviewer: { label: '审稿人工作区', description: '引用原文、添加批注与修改建议并参与讨论', color: '#9a5b25' },
  editor: { label: '编辑工作区', description: '合并重复意见、锁定已确认段落并比较版本', color: '#5b4d8e' },
}
const roleIcon = (role: Role) => role === 'author' ? <FileDoneOutlined /> : role === 'reviewer' ? <CommentOutlined /> : <BranchesOutlined />
const formatDate = (value: number) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const statusMeta: Record<QueueStatus, { label: string; color: string }> = {
  queued: { label: '待提交', color: 'orange' },
  sending: { label: '同步中', color: 'blue' },
  failed: { label: '同步失败', color: 'red' },
  blocked: { label: '已退回', color: 'purple' },
  conflict: { label: '两边都改了', color: 'volcano' },
  sent: { label: '已送达', color: 'green' },
}
const kindLabel: Record<QueuedChange['kind'], string> = {
  'paragraph-edit': '段落正文',
  'paragraph-lock': '段落锁定',
  'comment-add': '新增批注',
  'comment-reply': '讨论回复',
  'comment-merge': '合并意见',
}
const ACTIVE_QUEUE: QueueStatus[] = ['queued', 'sending', 'failed', 'blocked', 'conflict']

export default function App() {
  const {
    role, paragraphs, comments, versions, selectedParagraphId, commentFilter, revisionMode, dirty,
    online, weakNetwork, syncing, queue, shelf, lastSyncAt, lastError, serverRefs,
    setRole, selectParagraph, setCommentFilter, setRevisionMode, updateParagraph, addComment, replyComment,
    resolveSuggestion, mergeComment, toggleLock, createVersion, undo, redo, save, resetDemo,
    setOnline, setWeakNetworkMode, syncNow, resolveQueueConflict, retryQueuedChange, removeQueuedChange,
    clearSentQueue, restoreShelfVersion, removeShelfVersion,
    simulateRemoteParagraphEdit, simulateRemoteParagraphLock, simulateRemoteCommentMerge,
  } = useReviewStore()
  const [composerOpen, setComposerOpen] = useState(false)
  const [commentType, setCommentType] = useState<CommentType>('comment')
  const [commentBody, setCommentBody] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [quote, setQuote] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [versionOpen, setVersionOpen] = useState(false)
  const [versionA, setVersionA] = useState(versions[1]?.id ?? versions[0]?.id)
  const [versionB, setVersionB] = useState(versions[0]?.id)
  const [versionLabel, setVersionLabel] = useState('')
  const [queueOpen, setQueueOpen] = useState(false)
  const [simMergeCommentId, setSimMergeCommentId] = useState<string | undefined>()
  const autoSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selected = paragraphs.find((paragraph) => paragraph.id === selectedParagraphId) ?? paragraphs[0]
  const sections = useMemo(() => Array.from(new Set(paragraphs.map((paragraph) => paragraph.section))), [paragraphs])
  const paragraphCommentCounts = useMemo(() => comments.reduce<Record<string, number>>((acc, comment) => {
    acc[comment.paragraphId] = (acc[comment.paragraphId] ?? 0) + 1
    return acc
  }, {}), [comments])
  const duplicateParagraphIds = useMemo(() => new Set(Object.entries(paragraphCommentCounts).filter(([, count]) => count > 1).map(([id]) => id)), [paragraphCommentCounts])
  const visibleComments = useMemo(() => comments.filter((comment) => {
    if (commentFilter === 'open') return comment.status === 'open'
    if (commentFilter === 'suggestion') return comment.type === 'suggestion' && comment.status === 'open'
    if (commentFilter === 'duplicate') return duplicateParagraphIds.has(comment.paragraphId) && comment.status === 'open'
    return true
  }).sort((a, b) => b.createdAt - a.createdAt), [commentFilter, comments, duplicateParagraphIds])

  const paragraphQueue = useMemo(() => {
    const map: Record<string, QueuedChange> = {}
    for (const item of queue) {
      if (item.kind !== 'paragraph-edit' || !ACTIVE_QUEUE.includes(item.status) || !item.paragraphId) continue
      if (!map[item.paragraphId] || item.updatedAt > map[item.paragraphId].updatedAt) map[item.paragraphId] = item
    }
    return map
  }, [queue])
  const commentQueue = useMemo(() => {
    const map: Record<string, QueuedChange> = {}
    for (const item of queue) {
      if ((item.kind !== 'comment-add' && item.kind !== 'comment-reply' && item.kind !== 'comment-merge') || !ACTIVE_QUEUE.includes(item.status)) continue
      const key = item.kind === 'comment-add' ? item.id : item.commentId
      if (!key) continue
      if (!map[key] || item.updatedAt > map[key].updatedAt) map[key] = item
    }
    return map
  }, [queue])
  const conflictItems = useMemo(() => queue.filter((item) => item.status === 'conflict'), [queue])
  const pendingCount = queue.filter((item) => ACTIVE_QUEUE.includes(item.status)).length
  const failedCount = queue.filter((item) => item.status === 'failed' || item.status === 'blocked').length
  const sentItems = queue.filter((item) => item.status === 'sent')

  // 有新的待提交条目且在线时，自动延迟对账；失败的重试只补没送成功的
  const queueSignature = queue.map((item) => `${item.id}:${item.status}`).join('|')
  useEffect(() => {
    if (!online) return
    const hasFresh = queue.some((item) => item.status === 'queued')
    if (!hasFresh) return
    if (autoSyncTimer.current) clearTimeout(autoSyncTimer.current)
    autoSyncTimer.current = setTimeout(() => { void syncNow(true) }, 900)
    return () => { if (autoSyncTimer.current) clearTimeout(autoSyncTimer.current) }
  }, [queueSignature, online, syncNow])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      const state = useReviewStore.getState()
      const index = state.paragraphs.findIndex((paragraph) => paragraph.id === state.selectedParagraphId)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        event.shiftKey ? state.redo() : state.undo()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); state.redo()
      } else if (event.key.toLowerCase() === 'j') {
        event.preventDefault(); const next = state.paragraphs[Math.min(state.paragraphs.length - 1, index + 1)]; if (next) state.selectParagraph(next.id)
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault(); const previous = state.paragraphs[Math.max(0, index - 1)]; if (previous) state.selectParagraph(previous.id)
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault(); state.setRevisionMode(!state.revisionMode)
      } else if (event.key.toLowerCase() === 'l' && state.role === 'editor') {
        event.preventDefault(); state.toggleLock(state.selectedParagraphId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const scrollToParagraph = (id: string) => {
    selectParagraph(id)
    document.getElementById(`paragraph-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const openComposer = (type: CommentType) => {
    const selectedText = window.getSelection()?.toString().trim()
    setQuote(selectedText && selected?.text.includes(selectedText) ? selectedText : selected?.text.slice(0, 64) ?? '')
    setSuggestion(type === 'suggestion' ? selected?.text ?? '' : '')
    setCommentType(type)
    setComposerOpen(true)
  }
  const submitComment = () => {
    if (!selected || !commentBody.trim()) { message.warning('请填写批注内容'); return }
    addComment({ paragraphId: selected.id, type: commentType, quote, body: commentBody.trim(), suggestion: commentType === 'suggestion' ? suggestion : undefined })
    setCommentBody(''); setSuggestion(''); setQuote(''); setComposerOpen(false)
    message.success(online ? '批注已进入同步队列并自动提交' : '当前断网，批注已攒入本地待提交队列')
  }
  const handleManualSync = async () => {
    if (!online) { message.warning('当前断网，改动先留在本地队列，网络恢复后自动对账'); return }
    const result = await syncNow(false)
    if (!result) return
    if (result.sent) message.success(`已对账 ${result.sent} 条改动${result.pulled ? `，拉取 ${result.pulled} 处远端更新` : ''}`)
    if (result.conflicts) message.warning(`${result.conflicts} 个段落两边都改过，请挑选保留版本`)
    if (result.blocked) message.warning(`${result.blocked} 条改动被服务端退回（锁定或意见已合并）`)
    if (result.failed) message.error(`${result.failed} 条未送达，已留在队列，重试时只补这些`)
    if (!result.sent && !result.conflicts && !result.blocked && !result.failed) message.info('没有待提交的改动')
  }
  const handleCreateVersion = () => {
    if (versionLabel.trim()) createVersion(versionLabel.trim())
    else createVersion('')
    setVersionLabel('')
    message.success('当前版本已保存')
  }
  const comparedA = versions.find((version) => version.id === versionA)
  const comparedB = versions.find((version) => version.id === versionB)
  const comparedRows = comparedA && comparedB ? comparedA.paragraphs.map((paragraph, index) => ({ a: paragraph, b: comparedB.paragraphs[index] })) : []

  const describeQueueItem = (item: QueuedChange) => {
    const paragraph = item.paragraphId ? paragraphs.find((p) => p.id === item.paragraphId) : undefined
    if (item.kind === 'paragraph-edit') return { title: `段落 ${paragraph?.number ?? ''} 正文修改`, body: item.text }
    if (item.kind === 'paragraph-lock') return { title: `段落 ${paragraph?.number ?? ''} ${item.locked ? '锁定' : '解锁'}`, body: undefined }
    if (item.kind === 'comment-add') {
      const target = comments.find((comment) => comment.id === item.id)
      return { title: `新增${item.comment?.type === 'suggestion' ? '修改建议' : '段落批注'}`, body: item.comment?.body ?? target?.body }
    }
    if (item.kind === 'comment-reply') {
      const target = comments.find((comment) => comment.id === item.commentId)
      return { title: `回复“${target?.author ?? '批注'}”的意见`, body: item.reply?.body }
    }
    const target = comments.find((comment) => comment.id === item.commentId)
    const mergeTarget = comments.find((comment) => comment.id === item.targetCommentId)
    return { title: `把“${target?.author ?? '该意见'}”的意见合并到“${mergeTarget?.author ?? '另一意见'}”`, body: undefined }
  }

  const renderQueueActions = (item: QueuedChange) => {
    if (item.status === 'sending') return <Spin size="small" />
    if (item.status === 'conflict') {
      return role === 'author'
        ? <Space size={4} wrap>
            <Button size="small" onClick={() => resolveQueueConflict(item.id, 'local')}>保留本页</Button>
            <Button size="small" type="primary" onClick={() => resolveQueueConflict(item.id, 'remote')}>采用远端</Button>
          </Space>
        : <Tag>等待作者挑版本</Tag>
    }
    if (item.status === 'blocked') {
      return <Space size={4}>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => retryQueuedChange(item.id)}>重新提交</Button>
        <Tooltip title="放弃这条改动（落选正文可随后从存档找回）"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeQueuedChange(item.id)} /></Tooltip>
      </Space>
    }
    if (item.status === 'failed') {
      return <Space size={4}>
        <Button size="small" type="primary" icon={<ReloadOutlined />} onClick={() => retryQueuedChange(item.id)}>重试</Button>
        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeQueuedChange(item.id)} />
      </Space>
    }
    if (item.status === 'queued') {
      return <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeQueuedChange(item.id)} />
    }
    return <small style={{ color: '#8a8178' }}>{formatDate(item.updatedAt)}</small>
  }

  const renderShelfActions = (item: ShelvedVersion) => (
    <Space size={4}>
      <Button size="small" type="primary" icon={<SwapOutlined />} onClick={() => { restoreShelfVersion(item.id); message.success('落选版本已找回并重新排队') }}>找回这版</Button>
      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeShelfVersion(item.id)} />
    </Space>
  )

  const simMergeOptions = comments
    .filter((comment) => comment.paragraphId === selected?.id && comment.status === 'open')
    .map((comment) => ({ label: `${comment.author} · ${comment.body.slice(0, 14)}…`, value: comment.id }))

  return (
    <div className="review-app">
      <header className="app-header">
        <div className="paper-identity">
          <div className="paper-mark">CR</div>
          <div><h1>学术论文协作审阅台</h1><p>Collaborative Research Review · MS-2026-0417</p></div>
        </div>
        <div className="role-switch">
          <Segmented block value={role} onChange={(value) => setRole(value as Role)} options={(Object.keys(roleMeta) as Role[]).map((item) => ({ label: <span>{roleIcon(item)} {roleMeta[item].label.replace('工作区', '')}</span>, value: item }))} />
        </div>
        <Space>
          <Tooltip title={online ? '联网中：改动自动与审阅服务对账' : '断网中：改动攒在本地队列，恢复后自动同步'}>
            <span className="online-switch">
              {online ? <CloudOutlined /> : <DisconnectOutlined />}
              <Switch checked={online} checkedChildren="联网" unCheckedChildren="断网" onChange={setOnline} />
            </span>
          </Tooltip>
          <Badge count={pendingCount} size="small">
            <Button icon={<InboxOutlined />} danger={failedCount > 0} onClick={() => setQueueOpen(true)}>
              待提交队列
            </Button>
          </Badge>
          <Tooltip title="只补没送成功的段落，已送达的不会重发">
            <Button type="primary" ghost icon={<ReloadOutlined spin={syncing} />} loading={syncing} onClick={() => void handleManualSync()}>同步</Button>
          </Tooltip>
          <Badge dot={dirty}><Button icon={<SaveOutlined />} onClick={() => { save(); message.success('草稿已保存到浏览器') }}>保存</Button></Badge>
          <Button icon={<UndoOutlined />} disabled={!useReviewStore.getState().past.length} onClick={undo} />
          <Button icon={<RedoOutlined />} disabled={!useReviewStore.getState().future.length} onClick={redo} />
        </Space>
      </header>

      <div className="role-banner" style={{ '--role-color': roleMeta[role].color } as React.CSSProperties}>
        <span className="role-badge">{roleIcon(role)} {roleMeta[role].label}</span>
        <span>{roleMeta[role].description}</span>
        <span className="queue-banner-state" onClick={() => setQueueOpen(true)}>
          {online ? <CloudOutlined /> : <DisconnectOutlined />}
          {online ? (syncing ? '正在逐段对账…' : `在线 · 上次对账 ${lastSyncAt ? formatDate(lastSyncAt) : '尚未'}`) : '离线编辑中，改动已进入本地队列'}
          {!!pendingCount && <Tag color={failedCount ? 'red' : 'orange'} style={{ marginLeft: 6 }}>{pendingCount} 条待提交</Tag>}
        </span>
        <span className="paper-state"><FileTextOutlined /> 论文正文 v2.4</span>
      </div>

      {conflictItems.map((item) => {
        const paragraph = item.paragraphId ? paragraphs.find((p) => p.id === item.paragraphId) : undefined
        return (
          <div className="conflict-stack" key={item.id}>
            <Alert
              type="error" showIcon
              message={`段落 ${paragraph?.number ?? ''} 两边都改过：${item.author} 与 ${item.remoteAuthor} 同时修改`}
              description={(
                <div className="conflict-content">
                  <div><b>本页版本</b><p>{item.text}</p></div>
                  <div><b>远端版本（修订 {item.remoteRevision}）</b><p>{item.remoteText}</p></div>
                  <Space>
                    {role === 'author'
                      ? <>
                        <Button size="small" type="primary" onClick={() => resolveQueueConflict(item.id, 'local')}>保留本页</Button>
                        <Button size="small" onClick={() => resolveQueueConflict(item.id, 'remote')}>采用远端</Button>
                      </>
                      : <Tag>请切换到作者工作区挑选版本</Tag>}
                    <Button size="small" type="text" onClick={() => setQueueOpen(true)}>在队列中查看</Button>
                  </Space>
                </div>
              )}
            />
          </div>
        )
      })}

      {!online && (
        <div className="conflict-stack">
          <Alert type="warning" showIcon message="当前处于断网状态，段落、批注和回复都攒在本地待提交队列；网络恢复后将逐段与审阅服务对账合并。" />
        </div>
      )}
      {online && lastError && !syncing && (
        <div className="conflict-stack">
          <Alert type="error" showIcon message={`上次同步有未送达的改动：${lastError}。队列保留原样，可点“同步”只补失败的段落。`}
            action={<Button size="small" onClick={() => void handleManualSync()}>立即重试</Button>} />
        </div>
      )}

      <main className="workspace">
        <aside className="toc-panel">
          <div className="panel-title"><MenuFoldOutlined /> 侧边目录</div>
          <nav>
            {sections.map((section) => (
              <div key={section} className="toc-section">
                <strong>{section}</strong>
                {paragraphs.filter((paragraph) => paragraph.section === section).map((paragraph) => (
                  <button key={paragraph.id} className={paragraph.id === selected?.id ? 'active' : ''} onClick={() => scrollToParagraph(paragraph.id)}>
                    <span>{paragraph.number}</span>
                    <span>{paragraph.text.slice(0, 24)}…</span>
                    {paragraph.status === 'locked' && <LockOutlined />}
                    {!!paragraphCommentCounts[paragraph.id] && <Badge count={paragraphCommentCounts[paragraph.id]} size="small" />}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="version-box">
            <div className="panel-title"><HistoryOutlined /> 版本</div>
            <Input value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} placeholder="新版本名称" onPressEnter={handleCreateVersion} />
            <Button block icon={<PlusOutlined />} onClick={handleCreateVersion}>保存当前版本</Button>
            <Button block icon={<DiffOutlined />} onClick={() => setVersionOpen(true)}>比较两个版本</Button>
          </div>
        </aside>

        <section className="document-panel">
          <div className="document-toolbar">
            <div><h2>大语言模型辅助下的开源维护协作研究</h2><p>作者：林晓、陈默、王远 · 最近保存 {formatDate(Date.now())}</p></div>
            <Space>
              <Checkbox checked={revisionMode} onChange={(event) => setRevisionMode(event.target.checked)}>修订模式</Checkbox>
              <Tag color={dirty ? 'gold' : 'green'}>{dirty ? '有未保存修改' : '已保存'}</Tag>
            </Space>
          </div>

          <div className="paper-sheet">
            <div className="paper-kicker">RESEARCH ARTICLE · CONFIDENTIAL REVIEW</div>
            {sections.map((section) => (
              <section key={section} className="paper-section">
                <h3>{section}</h3>
                {paragraphs.filter((paragraph) => paragraph.section === section).map((paragraph) => {
                  const queued = paragraphQueue[paragraph.id]
                  return (
                    <article
                      id={`paragraph-${paragraph.id}`} key={paragraph.id} onMouseUp={() => setQuote(window.getSelection()?.toString().trim() ?? '')}
                      className={`paragraph-card ${paragraph.id === selected?.id ? 'selected' : ''} ${paragraph.highlighted ? 'highlighted' : ''} ${paragraph.status === 'locked' ? 'locked' : ''}`}
                      onClick={() => selectParagraph(paragraph.id)}
                    >
                      <div className="paragraph-meta">
                        <span className="paragraph-no">{paragraph.number}</span>
                        <span>段落 {paragraph.number.replace('.', '')}</span>
                        {paragraph.status === 'locked' && <Tag icon={<LockOutlined />} color="purple">已锁定</Tag>}
                        {paragraph.status === 'accepted' && <Tag icon={<CheckOutlined />} color="green">已确认</Tag>}
                        {!!paragraphCommentCounts[paragraph.id] && <Tag icon={<MessageOutlined />}>{paragraphCommentCounts[paragraph.id]} 条意见</Tag>}
                        {queued && <Tag color={statusMeta[queued.status].color} icon={<ClockCircleOutlined />} onClick={(event) => { event.stopPropagation(); setQueueOpen(true) }}>{statusMeta[queued.status].label}</Tag>}
                      </div>
                      {revisionMode ? (
                        <div className="revision-grid">
                          <div><small>原稿</small><p>{paragraph.original}</p></div>
                          <div><small>当前修订</small><p>{paragraph.text}</p></div>
                        </div>
                      ) : role === 'author' ? (
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} value={paragraph.text} readOnly={paragraph.status === 'locked'} onChange={(event) => updateParagraph(paragraph.id, event.target.value)} />
                      ) : (
                        <p className="paragraph-text">{paragraph.text}</p>
                      )}
                      {queued && (queued.status === 'blocked' || queued.status === 'failed' || queued.status === 'conflict') && (
                        <div className="queue-inline-note" onClick={() => setQueueOpen(true)}>
                          {queued.status === 'blocked' && `服务端退回：${queued.blockDetail ?? '段落可能已被编辑锁定'}，改动仍在队列里`}
                          {queued.status === 'failed' && `未送达：${queued.lastError ?? '网络异常'}，恢复后只补这一段`}
                          {queued.status === 'conflict' && '远端也改了这一段，需要作者挑选保留哪一版（落选版本可找回）'}
                        </div>
                      )}
                      <div className="paragraph-actions">
                        {role === 'reviewer' && <><Button size="small" icon={<CommentOutlined />} onClick={(event) => { event.stopPropagation(); selectParagraph(paragraph.id); openComposer('comment') }}>添加批注</Button><Button size="small" icon={<FileDoneOutlined />} onClick={(event) => { event.stopPropagation(); selectParagraph(paragraph.id); openComposer('suggestion') }}>提出建议</Button></>}
                        {role === 'editor' && <Button size="small" icon={paragraph.status === 'locked' ? <UnlockOutlined /> : <LockOutlined />} onClick={(event) => { event.stopPropagation(); toggleLock(paragraph.id) }}>{paragraph.status === 'locked' ? '解除锁定' : '锁定段落'}</Button>}
                        {role === 'author' && <span className="author-tip">可直接修改正文，右侧逐条处理建议；改动先进本地队列，联网后对账</span>}
                      </div>
                    </article>
                  )
                })}
              </section>
            ))}
          </div>
        </section>

        <aside className="comments-panel">
          <div className="comments-header">
            <div><h2><CommentOutlined /> 审阅意见 <Badge count={comments.filter((comment) => comment.status === 'open').length} /></h2><p>引用原文、讨论与修订建议</p></div>
          </div>
          <div className="comment-filters">
            <Radio.Group value={commentFilter} onChange={(event) => setCommentFilter(event.target.value)} buttonStyle="solid" size="small">
              <Radio.Button value="all">全部</Radio.Button><Radio.Button value="open">待处理</Radio.Button><Radio.Button value="suggestion">建议</Radio.Button><Radio.Button value="duplicate">重复</Radio.Button>
            </Radio.Group>
          </div>
          <div className="comment-list">
            {visibleComments.map((comment) => {
              const paragraph = paragraphs.find((item) => item.id === comment.paragraphId)
              const queued = commentQueue[comment.id]
              return (
                <Card key={comment.id} size="small" className={`comment-card ${comment.status}`} title={<span>{comment.author} <Tag>{comment.type === 'suggestion' ? '修改建议' : '段落批注'}</Tag>{queued && <Tag color={statusMeta[queued.status].color}>{statusMeta[queued.status].label}</Tag>}</span>} extra={<small>{formatDate(comment.createdAt)}</small>}>
                  <button className="quote-line" onClick={() => paragraph && scrollToParagraph(paragraph.id)}>“{comment.quote}” · 段落 {paragraph?.number}</button>
                  <p className="comment-body">{comment.body}</p>
                  {comment.suggestion && <div className="suggestion-box"><small>建议改为</small><p>{comment.suggestion}</p></div>}
                  {queued && (queued.status === 'blocked' || queued.status === 'failed') && (
                    <div className="queue-inline-note" onClick={() => setQueueOpen(true)}>
                      {queued.status === 'blocked' ? `服务端退回：${queued.blockDetail}` : `未送达：${queued.lastError}`}
                    </div>
                  )}
                  {comment.status !== 'open' && <Tag color={comment.status === 'accepted' ? 'green' : comment.status === 'rejected' ? 'red' : 'blue'}>{comment.status === 'accepted' ? '已接受' : comment.status === 'rejected' ? '已拒绝' : '已合并'}</Tag>}
                  <div className="replies">
                    {comment.replies.map((reply) => <div key={reply.id} className="reply"><b>{reply.author}</b><span>{reply.body}</span></div>)}
                  </div>
                  <div className="reply-box">
                    <Input size="small" value={replyDrafts[comment.id] ?? ''} onChange={(event) => setReplyDrafts((drafts) => ({ ...drafts, [comment.id]: event.target.value }))} placeholder="回复讨论…" onPressEnter={() => { const body = replyDrafts[comment.id]?.trim(); if (body) { replyComment(comment.id, body); setReplyDrafts((drafts) => ({ ...drafts, [comment.id]: '' })) } }} />
                    <Button size="small" type="text" icon={<SendOutlined />} onClick={() => { const body = replyDrafts[comment.id]?.trim(); if (body) { replyComment(comment.id, body); setReplyDrafts((drafts) => ({ ...drafts, [comment.id]: '' })) } }} />
                  </div>
                  {comment.status === 'open' && role === 'author' && comment.type === 'suggestion' && <div className="decision-row"><Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => resolveSuggestion(comment.id, true)}>接受修改</Button><Button danger size="small" icon={<CloseOutlined />} onClick={() => resolveSuggestion(comment.id, false)}>拒绝</Button></div>}
                  {comment.status === 'open' && role === 'editor' && duplicateParagraphIds.has(comment.paragraphId) && (() => {
                    const sibling = comments.find((item) => item.id !== comment.id && item.paragraphId === comment.paragraphId && item.status === 'open')
                    return sibling ? <Button size="small" type="dashed" icon={<BranchesOutlined />} onClick={() => mergeComment(comment.id, sibling.id)}>合并到“{sibling.author}”意见</Button> : null
                  })()}
                </Card>
              )
            })}
            {!visibleComments.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下没有意见" />}
          </div>
          <div className="keyboard-hint"><span><kbd>J</kbd>/<kbd>K</kbd> 段落导航</span><span><kbd>T</kbd> 修订模式</span>{role === 'editor' && <span><kbd>L</kbd> 锁定</span>}<span><kbd>⌘Z</kbd> 撤销</span></div>
        </aside>
      </main>

      <Drawer
        title={<Space><InboxOutlined /> 本地待提交队列</Space>}
        width={560} open={queueOpen} onClose={() => setQueueOpen(false)}
        extra={<Space>
          <Checkbox checked={weakNetwork} onChange={(event) => setWeakNetworkMode(event.target.checked)}>模拟弱网（每 3 次请求失败 1 次）</Checkbox>
          {!!sentItems.length && <Button size="small" onClick={clearSentQueue}>清空已送达（{sentItems.length}）</Button>}
        </Space>}
      >
        <Alert
          type={online ? 'info' : 'warning'} showIcon
          message={online ? '在线模式：改动自动逐段与审阅服务对账，失败的段落留在队列里，只补没送成功的。' : '离线模式：段落、批注和回复先攒在本队列，网络恢复后逐段对账合并。'}
          style={{ marginBottom: 12 }}
        />
        <div className="queue-summary">
          <Tag color="orange">{queue.filter((item) => item.status === 'queued').length} 待提交</Tag>
          <Tag color="blue">{queue.filter((item) => item.status === 'sending').length} 同步中</Tag>
          <Tag color="red">{queue.filter((item) => item.status === 'failed').length} 失败</Tag>
          <Tag color="purple">{queue.filter((item) => item.status === 'blocked').length} 被退回</Tag>
          <Tag color="volcano">{conflictItems.length} 冲突</Tag>
          <Tag color="green">{sentItems.length} 已送达</Tag>
          <span className="queue-last-sync"><ClockCircleOutlined /> 上次对账：{lastSyncAt ? formatDate(lastSyncAt) : '尚未'}</span>
        </div>

        <Divider orientation="left" plain>待处理改动</Divider>
        <div className="queue-list">
          {queue.filter((item) => ACTIVE_QUEUE.includes(item.status)).length === 0 && (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={online ? '队列是空的，所有改动都已送达审阅服务' : '离线后这里会按段落攒住全部改动'} />
          )}
          {queue.filter((item) => ACTIVE_QUEUE.includes(item.status)).map((item) => {
            const description = describeQueueItem(item)
            return (
              <Card key={item.id} size="small" className={`queue-item queue-${item.status}`}>
                <div className="queue-item-head">
                  <Space size={4} wrap><Tag color="geekblue">{kindLabel[item.kind]}</Tag><Tag color={statusMeta[item.status].color}>{statusMeta[item.status].label}</Tag><small>{item.author} · {formatDate(item.createdAt)}</small></Space>
                </div>
                <div className="queue-item-title">{description.title}</div>
                {description.body && item.kind === 'paragraph-edit' && item.status === 'conflict' && (
                  <div className="conflict-content">
                    <div><b>本页版本</b><p>{item.text}</p></div>
                    <div><b>远端版本</b><p>{item.remoteText}</p></div>
                  </div>
                )}
                {description.body && item.status !== 'conflict' && <p className="queue-item-body">{description.body}</p>}
                {item.status === 'failed' && <div className="queue-error">未送达：{item.lastError}（已尝试 {item.attempts} 次）</div>}
                {item.status === 'blocked' && <div className="queue-error">服务端退回：{item.blockDetail ?? '远端状态已变化'}。改动保留在队列中，处理后可重新提交。</div>}
                <div className="queue-item-actions">{renderQueueActions(item)}</div>
              </Card>
            )
          })}
        </div>

        <Divider orientation="left" plain>落选版本存档（{shelf.length}）</Divider>
        <div className="queue-list">
          {!shelf.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="挑版本时落选的本页/远端版本会存到这里，随时可以找回" />}
          {shelf.map((item) => (
            <Card key={item.id} size="small" className="queue-item queue-shelf">
              <div className="queue-item-head">
                <Space size={4} wrap>
                  <Tag color={item.source === 'local' ? 'gold' : 'cyan'}>{item.source === 'local' ? '落选的本页版本' : '落选的远端版本'}</Tag>
                  <small>段落 {item.paragraphNumber} · {item.author}</small>
                </Space>
              </div>
              <p className="queue-item-body">{item.text}</p>
              <div className="queue-item-actions">{renderShelfActions(item)}</div>
            </Card>
          ))}
        </div>

        <Divider orientation="left" plain><Space><ApiOutlined /> 审阅服务模拟（别人在服务端的动作）</Space></Divider>
        <div className="server-sim-box">
          <p>选中段落后，模拟协作者在服务端直接改动；先断网改本地，再让远端改动，恢复网络即可看到逐段对账。</p>
          <Space wrap>
            <Button size="small" icon={<EditOutlinedAlt />} disabled={!selected} onClick={() => {
              if (!selected) return
              const text = simulateRemoteParagraphEdit(selected.id)
              if (text) message.info(`远端协作者修改了段落 ${selected.number}`)
            }}>远端修改当前段落</Button>
            <Button size="small" icon={<LockOutlined />} disabled={!selected} onClick={() => { simulateRemoteParagraphLock(selected.id, true); message.info('远端编辑已锁定该段落') }}>远端锁定当前段落</Button>
            <Button size="small" icon={<UnlockOutlined />} disabled={!selected} onClick={() => { simulateRemoteParagraphLock(selected.id, false); message.info('远端编辑已解锁该段落') }}>远端解锁</Button>
          </Space>
          <div className="server-sim-merge">
            <Select size="small" placeholder="选择当前段落的一条意见" value={simMergeCommentId} onChange={setSimMergeCommentId}
              options={simMergeOptions} style={{ minWidth: 260 }} />
            <Button size="small" icon={<BranchesOutlined />} disabled={!simMergeCommentId} onClick={() => {
              if (!simMergeCommentId) return
              const target = comments.find((comment) => comment.id !== simMergeCommentId && comment.paragraphId === selected?.id)
              if (!target) { message.warning('当前段落没有可合并到的另一条意见'); return }
              simulateRemoteCommentMerge(simMergeCommentId, target.id)
              message.info('远端编辑已合并该意见，相关回复将被退回队列')
            }}>远端合并这条意见</Button>
          </div>
          <p className="server-sim-hint">服务端段落修订：{selected ? `段落 ${selected.number} = r${serverRefs.paragraphs[selected.id]?.revision ?? 1}` : '—'}</p>
        </div>

        <Divider />
        <Button block danger type="dashed" size="small" icon={<DeleteOutlined />} onClick={() => { resetDemo(); message.success('已重置示例数据（含服务端与队列）') }}>重置全部示例数据</Button>
      </Drawer>

      <Modal title={commentType === 'suggestion' ? '提出修改建议' : '添加段落批注'} open={composerOpen} onCancel={() => setComposerOpen(false)} onOk={submitComment} okText="提交" width={620}>
        <div className="composer">
          <label>引用原文</label>
          <Input.TextArea value={quote} onChange={(event) => setQuote(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} />
          <label>{commentType === 'suggestion' ? '建议改为' : '批注内容'}</label>
          {commentType === 'suggestion' && <Input.TextArea value={suggestion} onChange={(event) => setSuggestion(event.target.value)} autoSize={{ minRows: 3, maxRows: 7 }} />}
          <label>说明</label>
          <Input.TextArea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="说明修改理由或希望作者关注的问题" autoSize={{ minRows: 2, maxRows: 5 }} />
        </div>
      </Modal>

      <Modal title="版本比较" open={versionOpen} onCancel={() => setVersionOpen(false)} footer={null} width={980}>
        <div className="compare-selectors">
          <Select value={versionA} onChange={setVersionA} options={versions.map((version) => ({ label: `${version.label} · ${formatDate(version.createdAt)}`, value: version.id }))} />
          <ArrowLeftOutlined />
          <Select value={versionB} onChange={setVersionB} options={versions.map((version) => ({ label: `${version.label} · ${formatDate(version.createdAt)}`, value: version.id }))} />
        </div>
        <div className="version-table">
          <div className="version-head"><b>{comparedA?.label ?? '版本 A'}</b><b>{comparedB?.label ?? '版本 B'}</b></div>
          {comparedRows.map(({ a, b }) => (
            <div key={a.id} className={`version-row ${a.text !== b?.text ? 'changed' : ''}`}>
              <div><span>{a.number}</span>{a.text}</div><div><span>{b?.number ?? '—'}</span>{b?.text ?? '段落已删除'}</div>
            </div>
          ))}
        </div>
      </Modal>

      <footer className="app-footer">
        <span>本地草稿与待提交队列自动持久化 · 断网可继续编辑，恢复后逐段对账合并，落选版本可找回</span>
        <Button type="text" size="small" icon={<DeleteOutlined />} onClick={() => { resetDemo(); message.success('已重置示例数据') }}>重置示例</Button>
      </footer>
    </div>
  )
}

/** 用图标表达“远端在编辑”，避免和顶部模拟按钮混淆 */
function EditOutlinedAlt() {
  return <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700 }}>远</span>
}
