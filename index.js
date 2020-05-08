// ... paste above here a getCurrentWindowOverride map as shown in the code above
const getCurrentWindowOverride = {}
const noop = async () => {
    console.error("As part of running in a View inside Platforms, this API call has been no-oped.");
    return {};
};

// the View namespace only exists on the promise-based v2 API - change to callbacks for v1 override
const createV1Api = (api, replaceFunction) => {
    return async (...args) => {
        let hasCb = typeof args[args.length-1] === 'function';
        let hasErrorCb = hasCb && typeof args[args.length-2] === 'function';
        if (api === 'addEventListener') {
            // listener will be a fn so want to make sure we dont think its a cb...
            hasCb = typeof args[2] === 'function';
            hasErrorCb = typeof args[3] === 'function';
        }
        let returnValue;
        let errored = false;
        try {
            returnValue = await replaceFunction(...args);
            if(api === 'create-window') {
                const { uuid, name } = returnValue;
                returnValue = fin.desktop.Window.wrap(uuid, name);
            }
        } catch (e) {
            errored = true;
            if(hasErrorCb) {
                const errorCb = args[args.length-1];
                errorCb(e);
            }
        }
        if (hasCb && !errored) {
            const cb = hasErrorCb ? args[args.length-2] : args[args.length-1];
            // keep the cb out of the try catch so we don't accidentally call the errorCb
            cb(returnValue);
        }
    };
}

// setup global objects that will be overwritten as we obtain more information or the target window is changed 
const { uuid, name } = fin.__internal_.initialOptions;
let v2Window = fin.Window.wrapSync({uuid, name});
let v1Window = fin.desktop.Window.wrap(uuid, name);
const ofPlatform = fin.Platform.getCurrentSync();

// point the getCurrent APIs at these objects
fin.Window.getCurrent = async () => v2Window;
fin.Window.getCurrentSync = () => v2Window;
fin.desktop.Window.getCurrent = () => v1Window;

//Override create window to use platform API - will create a normal OpenFin window (not in a View)
fin.Window.create = async (...args) => {
    const identity = await ofPlatform.createWindow(...args);
    return fin.Window.wrap(identity);
};
fin.desktop.Window.create = createV1Api('create-window', ofPlatform.createWindow.bind(ofPlatform));

const overwriteGetCurrent = (windowIdentity, apiMap) => {
    const { uuid, name } = windowIdentity;
    v2Window = fin.Window.wrapSync({uuid, name});
    v1Window = fin.desktop.Window.wrap(uuid, name);
    v2View = fin.View.getCurrentSync();

    Object.entries(apiMap).forEach(([api, type]) => {
        if (type === 'noop') {
            v1Window[api] = createV1Api(api, noop);
            v2Window[api] = noop;
        } else if (type === 'view') {
            let replaceFunction = v2View[api] && v2View[api].bind(v2View);
            if (api === 'addEventListener') {
                replaceFunction = v2View.on.bind(v2View);
            } else if (api === 'removeEventListener') {
                replaceFunction = v2View.removeListener.bind(v2View);
            }
            v1Window[api] = createV1Api(api, replaceFunction);
            v2Window[api] = v2View[api];
        } else if (typeof type === 'function') {
            v1Window[api] = createV1Api(api, type);
            v2Window[api] = type;
        }
        // if type === 'window', we already have the correct function there
    });
};

if (fin.me.isView) {
    // run this synchronously to be sure to overwrite the APIs ASAP - may target the wrong window if target changed and reloaded
    overwriteGetCurrent(fin.__internal_.initialOptions.target, getCurrentWindowOverride);
    // initial Options target is only correct on initial load, might have reloaded or navigated the view - use this call to fix the APIs targeting the window
    fin.me.getCurrentWindow().then(ofWin => overwriteGetCurrent(ofWin.identity, getCurrentWindowOverride));
    // Any time the view changes window target, update the API overrides to point at the new Window
    fin.View.getCurrentSync().on('target-changed', ({target}) => overwriteGetCurrent(target, getCurrentWindowOverride));
}