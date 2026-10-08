'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('multiclaude', {
  getState: () => call('state:get'),
  getIcon: () => call('icon:get'),
  saveProfile: (profile) => call('profile:save', profile),
  removeProfile: (id, trashData) => call('profile:remove', id, trashData),
  launch: (id) => call('profile:launch', id),
  othersRunning: (id) => call('signin:others', id),
  quitOthers: (id, force) => call('signin:quit-others', id, force),
  chooseClaudeApp: () => call('app:choose'),
  chooseDir: () => call('dir:choose'),
  suggestDir: (name) => call('dir:suggest', name),
});
