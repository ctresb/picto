import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Picto, picto } from 'pictoguys'
import './styles.css'

function App() {
  const guy = React.useMemo(() => picto.character('Sleeping Gizmo'), [])

  return (
    <main className="shell">
      <section className="stage" aria-label="Picto sleeping animation demo">
        <Picto char={guy} size={180} />
      </section>

      <div className="controls">
        <button
          type="button"
          onClick={() => guy.sleep()}
        >
          Dormir
        </button>
        <button
          type="button"
          onClick={() => guy.breath()}
        >
          Respirar
        </button>
        <button
          type="button"
          onClick={() => guy.stop()}
        >
          Parar
        </button>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
