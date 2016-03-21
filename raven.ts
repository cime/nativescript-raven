import platform = require("platform");
import application = require("application");
import http = require("http");
const StackTrace = require("stacktrace-js");
const ErrorStackParser = require("error-stack-parser");

const dsnKeys = "source protocol user pass host port path".split(" ");
const dsnPattern = /^(?:(\w+):)?\/\/(?:(\w+)(:\w+)?@)?([\w\.-]+)(?::(\d+))?(\/.*)/;

function parseDSN(str: string) {
    let m = dsnPattern.exec(str),
        dsn: any = {},
        i = 7;

    try {
        while (i--) dsn[dsnKeys[i]] = m[i] || "";
    } catch (e) {
        throw new Error("Invalid DSN: " + str);
    }

    if (dsn.pass) {
        throw new Error("Do not specify your secret key in the DSN. See: http://bit.ly/raven-secret-key");
    }

    return dsn;
}

function urlencode(obj: any) {
    let str = [];
    for (let p in obj) {
        if (obj.hasOwnProperty(p)) {
            str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
        }
    }

    return str.join("&");
}

function guid() {
    return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, function(c) {
        let r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

function getGlobalServer(uri) {
    // assemble the endpoint from the uri pieces
    let globalServer = "//" + uri.host +
        (uri.port ? ":" + uri.port : "");

    if (uri.protocol) {
        globalServer = uri.protocol + ":" + globalServer;
    }
    return globalServer;
}

enum LogLevel {
    Debug,
    Info,
    Warning,
    Error,
    Fatal
}

let DSN: string = null;
let URI: any = null;
let SERVER: any = null;
let ENDPOINT: any = null;
let USER_CONTEXT: any = {};
let PROJECT: any = null;

export function config(dsn: string): void {
    DSN = dsn;
    URI = parseDSN(dsn);
    SERVER = getGlobalServer(URI);

    let lastSlash = URI.path.lastIndexOf('/');
    let path = URI.path.substr(1, lastSlash);
    PROJECT = URI.path.substr(lastSlash + 1);

    ENDPOINT = SERVER + "/" + path + "api/" + PROJECT + "/store/";
}

function getOptions(options) {
    USER_CONTEXT.orientation = application.getOrientation();

    return {
        url: ENDPOINT,
        auth: {
            sentry_version: "7",
            sentry_client: "raven-ns/1.0",
            sentry_key: URI.user,
            sentry_secret: URI.pass && URI.pass.substr(1)
        },
        data: {
            event_id: guid(),
            project: PROJECT,
            timestamp: new Date(),
            level: LogLevel[options.level].toLowerCase(),
            platform: "node",
            message: options.error ? options.error.message : options.message,
            tags: {
                "uuid": platform.device.uuid,
                "ios_version": platform.device.osVersion
            },
            extra: USER_CONTEXT,
            exception: options.exception
        }
    };
}

function postData(options: any): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        try {
            http.request({
                method: "POST",
                url: options.url + "?" + urlencode(options.auth),
                headers: {
                    "Content-Type": "application/json",
                    "Origin": "nativescript://"
                },
                content: JSON.stringify(options.data)
            }).then((result) => {
                console.log("Response:");
                console.log(result.content.toString());

                if (result.statusCode === 200) {
                    resolve();
                } else {
                    console.error(result.content.toString());
                    reject();
                }
            }).catch((error) => {
                console.error(error);
                reject();
            });
        } catch (error) {
            reject(error);
        }
    });
}

export function setUserContext(context) {
    USER_CONTEXT = context;
}

export function error(error: Error) {
    StackTrace.fromError(error).then((stack) => {
        console.log(stack);
    }).catch((err) => {
        console.error(err);
    });

    let stack = ErrorStackParser.parse(error) || [];
    stack = stack.map((frame) => {
        return {
            filename: frame.fileName,
            abs_path: frame.fileName,
            lineno: frame.lineNumber,
            colno: frame.columnNumber,
            context_line: frame.functionName
        };
    }).reverse();

    let options = getOptions({
        level: LogLevel.Error,
        error: error,
        exception: [
            {
                type: error.name,
                value: error.message,
                stacktrace: {
                    frames: stack
                }
            }
        ]
    });

    return postData(options);
};

export function log(message, level: LogLevel = LogLevel.Info) {
    let options = getOptions({
        level: LogLevel.Info,
        message: message
    });

    return postData(options);
};
