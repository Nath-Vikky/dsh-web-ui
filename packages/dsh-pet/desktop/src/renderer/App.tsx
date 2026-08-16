import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'

import type { DesktopState, PetBridgeState, PetInteraction, PixelModelSummary } from '../shared/desktop-api.ts'
import { SpritePet } from './SpritePet.tsx'
import { animationForPetSnapshot, type SpriteAnimation } from './sprite-animation.ts'

interface DragState {
  pointerId: number
  begin: Promise<DesktopState>
}

interface Feedback {
  text: string
  kind: PetInteraction | 'error'
}

const phaseLabels: Record<string, string> = {
  idle: '待机中',
  waiting: '等待中',
  waiting_input: '等待输入',
  thinking: '思考中',
  tool: '调用工具中',
  review: '整理回复中',
  done: '任务完成',
  failed: '任务异常',
  blocked: '任务受阻',
}

const modelSourceLabels: Record<PixelModelSummary['source'], string> = {
  builtin: '内置',
  local: '本地',
  imported: '已导入',
}

export function App() {
  const [desktop, setDesktop] = useState<DesktopState>()
  const [pet, setPet] = useState<PetBridgeState>({ connection: 'connecting', snapshot: null })
  const [feedback, setFeedback] = useState<Feedback>()
  const [reactionAnimation, setReactionAnimation] = useState<SpriteAnimation>()
  const [models, setModels] = useState<PixelModelSummary[]>([])
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelError, setModelError] = useState<string>()
  const [busy, setBusy] = useState<PetInteraction | 'rename' | 'connection' | 'model'>()
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [editingConnection, setEditingConnection] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const [urlError, setUrlError] = useState<string>()
  const drag = useRef<DragState>()
  const feedbackTimer = useRef<number>()
  const animationTimer = useRef<number>()

  useEffect(() => {
    void window.petDesktop.getState().then(setDesktop)
    return window.petDesktop.onStateChanged(setDesktop)
  }, [])

  useEffect(() => {
    const unsubscribe = window.petDesktop.onPetStateChanged(setPet)
    void window.petDesktop.getPetState().then(setPet)
    return unsubscribe
  }, [])

  useEffect(() => {
    void window.petDesktop.getPixelModels().then(setModels, () => setModelError('模型列表读取失败'))
  }, [])

  useEffect(() => () => {
    if (feedbackTimer.current !== undefined) window.clearTimeout(feedbackTimer.current)
    if (animationTimer.current !== undefined) window.clearTimeout(animationTimer.current)
  }, [])

  const showFeedback = (next: Feedback, animation: SpriteAnimation): void => {
    setFeedback(next)
    setReactionAnimation(animation)
    if (feedbackTimer.current !== undefined) window.clearTimeout(feedbackTimer.current)
    if (animationTimer.current !== undefined) window.clearTimeout(animationTimer.current)
    feedbackTimer.current = window.setTimeout(() => setFeedback(undefined), 2600)
    animationTimer.current = window.setTimeout(() => setReactionAnimation(undefined), 1600)
  }

  const setDrawerOpen = (open: boolean): void => {
    void window.petDesktop.setDrawerOpen(open).then(setDesktop)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || desktop === undefined) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      begin: window.petDesktop.beginDrag(),
    }
  }

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean): void => {
    const current = drag.current
    if (current === undefined || current.pointerId !== event.pointerId) return
    drag.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    void current.begin.then(() => window.petDesktop.endDrag()).then((result) => {
      setDesktop(result.state)
      if (!cancelled && !result.moved) setDrawerOpen(!result.state.drawerOpen)
    })
  }

  const interact = (kind: PetInteraction): void => {
    if (pet.connection !== 'ready' || busy !== undefined) return
    setBusy(kind)
    void window.petDesktop.interact(kind).then((result) => {
      showFeedback(
        { text: result.reaction, kind },
        kind === 'feed' ? 'jumping' : 'waving',
      )
    }, () => {
      showFeedback({ text: '暂时连接不上 DSH Pet', kind: 'error' }, 'failed')
    }).finally(() => setBusy(undefined))
  }

  const submitRename = (event?: FormEvent): void => {
    event?.preventDefault()
    const name = nameDraft.trim()
    if (name === '' || name.length > 20 || busy !== undefined) return
    setBusy('rename')
    void window.petDesktop.renamePixelModel(name).then((state) => {
      setDesktop(state)
      setRenaming(false)
      showFeedback({ text: `以后就叫我${name}啦`, kind: 'pet' }, 'waving')
    }, () => {
      showFeedback({ text: '改名没有保存成功', kind: 'error' }, 'failed')
    }).finally(() => setBusy(undefined))
  }

  const submitConnection = (event: FormEvent): void => {
    event.preventDefault()
    if (busy !== undefined) return
    setBusy('connection')
    setUrlError(undefined)
    void window.petDesktop.setWebDshUrl(urlDraft).then((state) => {
      setDesktop(state)
      setUrlDraft(state.webDshUrl)
      setEditingConnection(false)
    }, () => {
      setUrlError('仅支持本机 Web DSH 的 http/https 根地址')
    }).finally(() => setBusy(undefined))
  }

  const selectModel = (model: PixelModelSummary): void => {
    if (busy !== undefined || desktop?.pixelModelId === model.id) {
      setModelMenuOpen(false)
      return
    }
    setBusy('model')
    setModelError(undefined)
    void window.petDesktop.selectPixelModel(model.id).then((state) => {
      setDesktop(state)
      setModelMenuOpen(false)
    }, () => setModelError('模型选择没有保存成功')).finally(() => setBusy(undefined))
  }

  const importModel = (): void => {
    if (busy !== undefined) return
    setBusy('model')
    setModelError(undefined)
    void window.petDesktop.importPixelModel().then(async (result) => {
      if (result.status === 'cancelled') return
      if (result.status === 'error') {
        setModelError(result.message)
        return
      }
      const nextModels = await window.petDesktop.getPixelModels()
      setModels(nextModels)
      setDesktop(await window.petDesktop.selectPixelModel(result.model.id))
      setModelMenuOpen(false)
    }, () => setModelError('模型导入失败')).finally(() => setBusy(undefined))
  }

  const snapshot = pet.snapshot
  const connected = pet.connection === 'ready'
  const statusText = feedback?.text
    ?? snapshot?.bubble
    ?? (connected ? phaseLabels[snapshot?.phase ?? 'idle'] ?? '状态同步中' : pet.connection === 'connecting' ? '正在连接 DSH Pet' : 'DSH Pet 未连接')
  const animation = reactionAnimation ?? animationForPetSnapshot(snapshot)
  const selectedModel = models.find(model => model.id === desktop?.pixelModelId) ?? models[0]
  const modelName = (model: PixelModelSummary): string => desktop?.pixelModelNames[model.id] ?? model.displayName
  const currentModelName = selectedModel === undefined ? '鲸鱼娘' : modelName(selectedModel)

  return (
    <main className={`desktop-shell ${desktop?.drawerOpen === true ? 'drawer-open' : ''}`}>
      <aside className="drawer" aria-hidden={desktop?.drawerOpen !== true}>
        <div className="drawer-header">
          <div>
            <p className="eyebrow">DSH PET DESKTOP</p>
            <h1>工作入口</h1>
          </div>
          <button className="icon-button" type="button" aria-label="关闭抽屉" onClick={() => setDrawerOpen(false)}>
            ×
          </button>
        </div>

        <button className="primary-action" type="button" onClick={() => void window.petDesktop.openDshWeb()}>
          打开 DSH Web
          <span>{desktop?.webDshUrl.replace(/^https?:\/\//, '') ?? '127.0.0.1:3080'}</span>
        </button>

        <div className="status-card">
          <span className={`status-dot ${connected ? '' : 'offline'}`} />
          <div>
            <strong>{connected ? '已连接 Web DSH' : '等待 Web DSH'}</strong>
            <p>{connected ? '状态与互动已同步' : '启动 Harness 后自动重连'}</p>
          </div>
          <button
            className="connection-settings"
            type="button"
            onClick={() => {
              setUrlDraft(desktop?.webDshUrl ?? 'http://127.0.0.1:3080')
              setUrlError(undefined)
              setEditingConnection(true)
            }}
          >
            地址
          </button>
        </div>

        {editingConnection ? (
          <form className="connection-form" onSubmit={submitConnection}>
            <input
              value={urlDraft}
              aria-label="Web DSH 地址"
              placeholder="http://127.0.0.1:3080"
              autoFocus
              onChange={event => setUrlDraft(event.target.value)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Escape') setEditingConnection(false)
              }}
            />
            <button type="submit" disabled={busy !== undefined}>保存</button>
            <button type="button" onClick={() => setEditingConnection(false)}>取消</button>
            {urlError !== undefined && <p className="connection-error">{urlError}</p>}
          </form>
        ) : (
          <div className="drawer-actions">
            <button type="button" onClick={() => void window.petDesktop.setLocked(desktop?.locked !== true)}>
              {desktop?.locked === true ? '解除位置锁定' : '锁定当前位置'}
            </button>
            <button type="button" onClick={() => void window.petDesktop.hide()}>
              隐藏到托盘
            </button>
          </div>
        )}
      </aside>

      <section className="pet-stage">
        <div className={`interaction-panel ${connected ? 'connected' : ''}`}>
          <div className="pet-summary">
            <span className={`connection-dot ${connected ? 'connected' : ''}`} />
            <strong>{currentModelName}</strong>
            <button
              className="model-menu-trigger"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={modelMenuOpen}
              onClick={() => {
                setModelError(undefined)
                setModelMenuOpen(open => !open)
              }}
            >
              模型列表
            </button>
          </div>
          {modelMenuOpen ? (
            <div className="model-menu">
              <div className="model-options" role="listbox" aria-label="像素模型">
                {models.map(model => (
                  <button
                    key={model.id}
                    className={model.id === selectedModel?.id ? 'selected' : ''}
                    type="button"
                    role="option"
                    aria-selected={model.id === selectedModel?.id}
                    disabled={busy !== undefined}
                    title={model.description}
                    onClick={() => selectModel(model)}
                  >
                    <span>{modelName(model)}</span>
                    <small>{model.id === selectedModel?.id ? '当前' : modelSourceLabels[model.source]}</small>
                  </button>
                ))}
              </div>
              <button className="model-import" type="button" disabled={busy !== undefined} onClick={importModel}>
                {busy === 'model' ? '正在处理' : '导入 PetDex 模型文件夹'}
              </button>
              {modelError !== undefined && <p className="model-error" role="alert">{modelError}</p>}
            </div>
          ) : (
            <>
              <p className={`pet-status ${feedback?.kind === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
                {statusText}
              </p>
              {renaming ? (
                <form className="rename-form" onSubmit={submitRename}>
                  <input
                    value={nameDraft}
                    maxLength={20}
                    aria-label="新的桌宠名字"
                    autoFocus
                    onChange={event => setNameDraft(event.target.value)}
                    onKeyDown={event => {
                      if (event.nativeEvent.isComposing) return
                      if (event.key === 'Escape') setRenaming(false)
                    }}
                  />
                  <button type="submit" disabled={busy !== undefined}>保存</button>
                  <button type="button" onClick={() => setRenaming(false)}>取消</button>
                </form>
              ) : (
                <div className="pet-actions">
                  <button type="button" disabled={!connected || busy !== undefined} onClick={() => interact('pet')}>
                    {busy === 'pet' ? '摸摸中' : '摸头'}
                  </button>
                  <button type="button" disabled={!connected || busy !== undefined} onClick={() => interact('feed')}>
                    {busy === 'feed' ? '喂食中' : '喂食'}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== undefined}
                    onClick={() => {
                      setNameDraft(currentModelName)
                      setRenaming(true)
                    }}
                  >
                    改名
                  </button>
                </div>
              )}
              <div className="pet-metrics">
                <span>{snapshot?.affinity.rank ?? '未同步'} · {snapshot?.affinity.points ?? 0} 亲密度</span>
                <span>小鱼干 {snapshot?.treats.stocked ?? 0}/{snapshot?.treats.max ?? 0}</span>
              </div>
            </>
          )}
        </div>

        <button
          className={`pet-button ${desktop?.locked === true ? 'locked' : ''}`}
          type="button"
          aria-label={desktop?.locked === true ? '打开桌宠抽屉，当前位置已锁定' : '打开桌宠抽屉或拖动桌宠'}
          onPointerDown={onPointerDown}
          onPointerUp={event => finishPointer(event, false)}
          onPointerCancel={event => finishPointer(event, true)}
        >
          <SpritePet animation={animation} model={selectedModel} />
        </button>
      </section>
    </main>
  )
}
