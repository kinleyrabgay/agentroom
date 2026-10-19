#!/usr/bin/env node
import { Command } from 'commander';
import { APP_VERSION } from '../shared/constants.js';
import { registerBot } from './commands/bot.js';
import { registerDoctor } from './commands/doctor.js';
import { registerInit } from './commands/init.js';
import { registerSkill } from './commands/skill.js';
import { registerStart } from './commands/start.js';
import { registerDaemon } from './commands/daemon.js';

const program = new Command().name('agentroom').description('Visual control room for your coding agents').version(APP_VERSION);

for (const register of [registerInit, registerStart, registerDaemon, registerBot, registerSkill, registerDoctor]) register(program);

program.parseAsync();
