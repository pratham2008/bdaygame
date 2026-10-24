import './style.css';

import { GameManager } from './systems/GameManager.js';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const game = new GameManager(canvas);

if (import.meta.env.DEV) {
  // This source-served import is deliberately outside the production graph.
  const devModuleUrl = '/src/systems/DevSceneTravel.ts';
  void import(/* @vite-ignore */ devModuleUrl).then(({ DevSceneTravel }) => {
    game.installDevelopmentOverlay(options => new DevSceneTravel(options));
  });
}

void game.start().catch(error => {
  console.error('[GameManager] Failed to start.', error);
});
