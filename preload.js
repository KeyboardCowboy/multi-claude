'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('multiclaude', {
  getState: () => call('state:get'),
  getIcon: () => call('icon:get'),
  saveProfile: (profile) => call('profile:save', profile),
  removeProfile: (id, trashData) => call('profile:remove', id, trashData),
  launch: (id, opts) => call('profile:launch', id, opts),
  othersRunning: (id) => call('signin:others', id),
  quitOthers: (id, force) => call('signin:quit-others', id, force),
  chooseClaudeApp: () => call('app:choose'),
  chooseDir: () => call('dir:choose'),
  labelAccount: (accountId, email) => call('account:label', accountId, email),
  acceptAccount: (profileId) => call('account:accept', profileId),
});
