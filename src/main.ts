import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from "fs";
import * as path from "path";

interface IRunnerContext {
  os?: string;
  tool_cache?: string;
  temp: string;
  workspace?: string;
}

// These are added run actions using "env:"
let runner: IRunnerContext = JSON.parse(process.env.RUNNER || '{"temp": "/temp"}');
let secrets: any = JSON.parse(process.env.SECRETS || '{}');
let outputpath = core.getInput('outputpath') || process.env.GITHUB_WORSPACE || '.'

const outputDir = path.join(outputpath, "nb-runner.out");
const scriptsDir = path.join(runner.temp, "nb-runner-scripts");
const executeScriptPath = path.join(scriptsDir, "nb-runner.py");
const secretsPath = path.join(runner.temp, "secrets.json");
const papermillOutput = path.join(outputpath, "papermill-nb-runner.out");

export async function run() {
  try {
    const notebookFile = core.getInput('notebook');
    const paramsFile = core.getInput('params');
    const isReport = core.getInput('isReport');
    const poll = core.getInput('poll');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, {recursive: true});
    }

    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, {recursive: true});
    }

    fs.writeFileSync(secretsPath, JSON.stringify(secrets));

    const parsedNotebookFile = path.join(outputDir, path.basename(notebookFile));
    // Install dependencies
    await exec.exec('python3 -m pip install papermill==2.5.0 ipykernel==6.29.3 nbformat==5.9.2 nbconvert==7.16.1');
    await exec.exec('python3 -m ipykernel install --user');

    // Execute notebook
    const pythonCode = `
import papermill as pm
import os
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from time import sleep

params = {}
paramsPath = '${paramsFile}'
extraParams = dict({ "secretsPath": '${secretsPath}' })
if os.path.exists(paramsPath):
  with open(paramsPath, 'r') as paramsFile:
    params = json.loads(paramsFile.read())

isDone = False    
def watch():
    global isDone
    while not isDone:
      sleep(15)
      os.system('echo "***Polling latest output status result***"')
      os.system('tail -n 15 ${papermillOutput}')
      os.system('echo "***End of polling latest output status result***"')

def run():
  global isDone
  try:
    pm.execute_notebook(
      input_path='${notebookFile}',
      output_path='${parsedNotebookFile}',
      parameters=dict(extraParams, **params),
      log_output=True,
      report_mode=${!!isReport ? "True" : "False"}
    )
  finally:
    isDone = True  
    
results = []
with ThreadPoolExecutor() as executor:
  results.append(executor.submit(run))
  if ${!!poll ? "True" : "False"}:
    results.append(executor.submit(watch))

for task in as_completed(results):
  try:
    task.result()
  except Exception as e:
    print(e, file=sys.stderr)
    sys.exit(1)
`;

    fs.writeFileSync(executeScriptPath, pythonCode);

    await exec.exec(`cat ${executeScriptPath}`)
    await exec.exec(`python3 ${executeScriptPath}`);

    // Convert to HTML
    await exec.exec(`jupyter nbconvert "${parsedNotebookFile}" --to html`);

  } catch (error) {
    core.setFailed((error as any).message);
  }
}
