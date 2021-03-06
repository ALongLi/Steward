/*global _gaq*/
import $ from 'jquery'
import CONST from '../constant'
import * as api from '../api/index'
import * as date from '../utils/date'
import storage from '../utils/storage'
import Toast from 'toastr'
import { saveWallpaperLink } from '../helper/wallpaper'
import browser from 'webextension-polyfill'

const $body = $('body');

let curUrl = '';
let intervalTimer = 0;
let $saveBtn;

function updateWallpaper(url, save, isNew) {
    if (!url) {
        return;
    }

    if (save) {
        window.localStorage.setItem(CONST.STORAGE.WALLPAPER, url);
    }

    if (isNew) {
        $saveBtn.show();
    } else {
        $saveBtn.hide();
    }

    curUrl = url;
    $('html').css({
        '--app-newtab-background-image': `url(${url})`
    });
    $body.trigger('wallpaper:refreshed');
}


function randomIndex(sourceWeights) {
    const list = [];

    sourceWeights.forEach((weight, index) => {
        for (let windex = 0; windex < weight; windex += 1) {
            list.push(index);
        }
    });

    return getRandomOne(list);
}

function getRandomOne(list) {
    if (list && list.length) {
        const index = Math.round(Math.random() * (list.length - 1));

        return list[index];
    }
}

const sourcesInfo = {
    bing: {
        api: method => () => api.bing[method](),
        handle: result => (api.bing.root + result.images[0].url),
        weight: 1
    },
    favorites: {
        api: () => storage.sync.get(CONST.STORAGE.WALLPAPERS, []),
        handle: result => getRandomOne(result),
        weight: 2
    },
    picsum: {
        api: () => api.picsum.getRandomImage(),
        handle: result => result,
        weight: 2
    },
    nasa: {
        api: () => api.nasa.getList(),
        handle: result => result.url,
        weight: 0.5
    },
    desktoppr: {
        api: () => api.desktoppr.getRandom(),
        handle: result => result.response.image.url,
        weight: 3
    }
};

function getSources(method) {
    let sources = window.stewardCache.config.general.wallpaperSources.slice(0);

    // default
    if (!sources || !sources.length) {
        sources = ['bing', 'favorites'];
    }

    console.log(sources);

    const sourceWeights = sources.map(item => sourcesInfo[item].weight);
    const index = randomIndex(sourceWeights);
    const sourceName = sources[index];
    const source = sourcesInfo[sourceName];
    const tasks = [];

    console.log(sourceName);

    if (sourceName === 'bing') {
        tasks.push(source.api(method));
        tasks.push(sourcesInfo.favorites.api);
    } else if (sourceName === 'favorites') {
        // there may be no pictures in the `favorites`
        tasks.push(sourcesInfo.bing.api(method));
        tasks.push(source.api);
    } else {
        tasks.push(source.api);
        tasks.push(sourcesInfo.favorites.api);
    }

    return {
        name: sourceName,
        tasks
    };
}

function recordSource(source) {
    window.localStorage.setItem('wallpaper_source', source);
}

export function refreshWallpaper(today) {
    const method = today ? 'today' : 'rand';
    const server = getSources(method);

    Promise.all(server.tasks.map(task => task())).then(sources => {
        // `result` will never be `favorites`.
        const [result, favorites] = sources;
        let type = server.name;

        if (type === 'favorites' && favorites.length === 0) {
            type = 'bing';
        }

        let wp;
        let isNew;

        if (type === 'favorites') {
            wp = sourcesInfo[type].handle(favorites);
            isNew = false;
        } else {
            wp = sourcesInfo[type].handle(result);
            isNew = favorites.indexOf(wp) === -1;
        }

        recordSource(type);
        updateWallpaper(wp, true, isNew);
    }).catch(resp => {
        console.log(resp);
    });
}

function bindEvents() {
    $('#j-refresh-wp').on('click', function() {
        refreshWallpaper();
        _gaq.push(['_trackEvent', 'wallpaper', 'click', 'refresh']);
    });

    $body.on('wallpaper:update', function(event, url) {
        updateWallpaper(url, true);
    });

    $saveBtn.on('click', function() {
        saveWallpaperLink(curUrl).then(() => {
            Toast.success('save successfully');
            $saveBtn.hide();
        }).catch(msg => {
            Toast.warning(msg);
        });
        _gaq.push(['_trackEvent', 'wallpaper', 'click', 'save']);
    });

    $(document).on('dblclick', function(event) {
        if (event.target.tagName === 'BODY') {
            clearInterval(intervalTimer);
            Toast.success('The automatic refresh of the wallpaper has been disabled');
        }
    });
}

export function init() {
    // restore
    const lastDate = new Date(window.localStorage.getItem(CONST.STORAGE.LASTDATE) || Number(new Date()));
    const defaultWallpaper = window.localStorage.getItem(CONST.STORAGE.WALLPAPER);
    const enableRandomWallpaper = window.stewardCache.config.general.enableRandomWallpaper;

    $saveBtn = $('#j-save-wplink');

    window.localStorage.setItem(CONST.STORAGE.LASTDATE, date.format());

    if (!defaultWallpaper) {
        refreshWallpaper();
    } else {
        if (date.isNewDate(new Date(), lastDate) && enableRandomWallpaper) {
            refreshWallpaper(true);
        } else {
            browser.storage.sync.get(CONST.STORAGE.WALLPAPERS).then(resp => {
                const list = resp[CONST.STORAGE.WALLPAPERS] || [];
                const isNew = list.indexOf(defaultWallpaper) === -1;

                updateWallpaper(defaultWallpaper, false, isNew);
            });
        }
    }

    bindEvents();

    api.picsum.refreshPicsumList();

    // set interval
    if (enableRandomWallpaper) {
        intervalTimer = setInterval(refreshWallpaper, CONST.NUMBER.WALLPAPER_INTERVAL);
    } else {
        console.log('disable random');
    }
}