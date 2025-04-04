import childProcess from "node:child_process";
import path from "node:path";
import { noop } from "@nesvet/n";
import { isRunning } from "#utils";
import { Stage } from "./Stage.js";


export class ChildProcess extends Stage {
	constructor({ command, watch, filterStdout, filterStderr, ...restOptions }) {
		super({
			symbol: "⚙️ ",
			title: `${command} process`,
			command,
			cwd: Object.values(process._conveyerEnv)[0]?.dir,
			watchdog: true,
			checkIfRunning: false,
			args: [],
			stdio: [
				"inherit",
				filterStdout ? "pipe" : "inherit",
				filterStderr ? "pipe" : "inherit",
				"ipc"
			],
			filterStdout,
			filterStderr,
			isDetached: false,
			...restOptions,
			watch: {
				paths: [],
				events: [ "change" ],
				...watch
			}
		});
		
	}
	
	#process = null;
	
	#isRestarting = false;
	
	#isStopped = false;
	
	async start() {
		
		if (this.checkIfRunning && await isRunning(this.command)) {
			this.stop = noop;
			console.warn(`⚠️${this.symbol} ${this.title} is already running`);
		} else {
			this.#process = childProcess.spawn(this.command, this.args, {
				detached: true,
				stdio: this.stdio,
				env: { ...process.env, ...this.env },
				cwd: this.cwd
			});
			
			if (!this.isDetached)
				this.#process.on("exit", this.watchdog ? this.#handleWatchdogExit : this.#handleExit);
			
			if (this.stdio.includes("ipc"))
				this.#process.on("message", this.#handleMessage);
			
			if (this.filterStdout)
				this.#process.stdout.on("data", data => {
					const string = data.toString();
					
					if (!this.filterStdout.some(substring => string.includes(substring)))
						process.stderr.write(string);
					
				});
			
			if (this.filterStderr)
				this.#process.stderr.on("data", data => {
					const string = data.toString();
					
					if (!this.filterStderr.some(substring => string.includes(substring)))
						process.stderr.write(string);
					
				});
		}
		
	}
	
	stop() {
		
		process.kill(-this.#process.pid, "SIGKILL");
		
	}
	
	async do() {
		
		if (this.#process) {
			this.#isRestarting = true;
			if (this.isDetached)
				this.stop();
			else
				await new Promise(resolve => {
					this.#process.on("exit", resolve);
					this.stop();
					
				});
			this.#isRestarting = false;
		}
		
		await this.start();
		
	}
	
	#handleMessage = message => {
		
		try {
			const [ kind, ...rest ] = message;
			this.#messageHandlers[kind].apply(this, rest);
		} catch {}
		
	};
	
	#messageHandlers = {
		
		restart(args) {
			if (args) {
				for (const arg of args) {
					const keyRegExp = new RegExp(`^${arg.replace(/=.*$/, "")}(=|$)`);
					const index = this.args.findIndex(thisArg => keyRegExp.test(thisArg));
					
					if (~index)
						this.args[index] = arg;
					else
						this.args.unshift(arg);
				}
				
				if (args.length && path.parse(args.at(-1)).root)
					if (this.args.length && path.parse(this.args.at(-1)).root)
						this.args[this.args.length - 1] = args.at(-1);
					else
						this.args.push(args.at(-1));
			}
			
			this.stop();
			
			if (!this.watchdog)
				this.start();
			
		}
		
	};
	
	#handleExit = () => {
		
		if (this.#isRestarting)
			this.#isRestarting = false;
		else {
			this.#process = null;
			console.info(`🚪${this.symbol} ${this.title} exited`);
		}
		
	};
	
	#handleWatchdogExit = () =>
		!this.#isStopped &&
		!this.#isRestarting &&
		this.start();
	
}
