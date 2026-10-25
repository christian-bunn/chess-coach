import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { WhoIsPlaying } from './components/WhoIsPlaying'
import { choosePlayer, currentPlayer } from './player'
import './styles.css'

/** Asks who's playing before anything else; each player's progress is their own. A new player starts afresh. */
function Root() {
  const [player, setPlayer] = useState(currentPlayer)
  const [switching, setSwitching] = useState(false)
  const choose = (name: string) => {
    choosePlayer(name)
    setPlayer(name)
    setSwitching(false)
  }
  return (
    <>
      {player && <App key={player} player={player} onSwitchPlayer={() => setSwitching(true)} />}
      {(!player || switching) && (
        <WhoIsPlaying current={player} onChoose={choose} onCancel={player ? () => setSwitching(false) : undefined} />
      )}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
