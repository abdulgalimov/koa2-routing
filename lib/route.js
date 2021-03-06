'use strict';

/**
 * koa2-routing
 *
 * @module route
 * @author Hanrea
 * @author Ivan Pusic
 * @license MIT
 */

var methods = require('methods'),
    pathToRegExp = require('path-to-regexp'),
    concat = require('concat-regexp'),
    util = require('./utils');

/**
 * Route object for saving route path and HTTP method handlers for route
 */
function Route(path,domain) {

    //Route domain  defalut is * mean all domain and no domain
    this._domain = domain || "*";

    /**
     * Cache for HTTP methods handlers
     */
    this.handlers = {};

    /**
     * nesteds route objects
     */
    this._nesteds = [];

    /**
     * defines function which will be executed before some set of routes
     */
    this._beforeFn = [];

    /**
     * path String object
     */
    this.path = path;

    /**
     * named parameters of route
     */
    this.params = [];

    /**
     * RegExp of path
     */
    this.pathRegex = path instanceof RegExp ? path : pathToRegExp(path, this.params);

    return this;
}

/**
 * Define supported HTTP methods for Route object
 * and all failback method
 */
if (!~ methods.indexOf('all')){
    methods.push('all');
}
methods.forEach(function (METHOD) {
    Route.prototype[METHOD] = function () {
        let cbs = Array.prototype.slice.apply(arguments);
        let that = this;
        cbs.forEach(function (cb) {
            util.isGenerator(cb, that);
        });
        this.handlers[METHOD.toUpperCase()] = cbs;
        return this;
    };
});

/**
 * Route domain selected
 */
Route.prototype.domain = function (domain) {
    this._domain = domain;
    return this;
};

/**
 * Function will be executed before each route HTTP method,
 * and before each nested route and it's defined HTTP methods
 *
 * @param { ...}  Functions whill be executed before routes
 *
 * @return {Route}
 * @api public
 */
Route.prototype.before = function () {
    let that = this;
    let cbs = Array.prototype.slice.apply(arguments);
    cbs.forEach(function (cb) {
        util.isGenerator(cb, that);
    });
    this._beforeFn = cbs;
    return this;
};


/**
 * Ability to nest routes
 *
 * @param {String} path path of nested route
 * @param {Function} cb callback function after nested route is created
 *
 * @return {Route}
 * @api public
 */
Route.prototype.nested = Route.prototype.next = function (path) {
    let route;
    if (this.path instanceof RegExp) {
        route = new Route(concat(this.path, path));
    } else {
        route = new Route(this.path.concat(path));
    }
    this._nesteds.push(route)
    //route._beforeFn = this._beforeFn;
    return route;
};


/**
 * redirect to new path
 * @param toPath
 * @returns {Route}
 */

Route.prototype.redirect = function (toPath) {
    this.handlers["redirect"] = [ async(ctx,next)=>{
        ctx.redirect(toPath)
    }];
    return this;
};

/**
 * static router
 * @param path  root floder  or file path
 * @returns {Route}
 */


const send = require('koa-send');
const { stat } = require('mz/fs');
const { resolve, extname, join,normalize } = require('path');
//safe decode URI
function safeDecodeURIComponent(text) {
  try {
      return decodeURIComponent(text);
  } catch (e) {
      return text;
  }
}

Route.prototype.static = function (root,replace) {
    let that = this;
    let staticRoute = async (ctx,next)=>{
        // onlysuport Head & GET method
        if (ctx.method !== 'HEAD' && ctx.method !== 'GET'){
            return await next();
        }
        let path = ctx.path;
        if(replace){
            path = path.replace(replace,"");
        }
        path = safeDecodeURIComponent(normalize(path));
        let done = false;
        try {
            let state = await stat(root);
            if (state.isFile()){
                return await send(ctx, path, {"root":root})
            }else{
                state = await stat(join(root, path));
                if(state.isFile()){
                    return await send(ctx, path, {"root":root})
                }
            }
        } catch (err) {
            return await next()
        }
        if (!done) {
            return await next()
        }
    };
    this.handlers["static"] = [staticRoute];
    return this;
};






/**
 * Function for matching route object with received koa request object
 *
 * @param {Object} request koa request object
 *
 * @return {Generator|null}
 * @api private
 */
Route.prototype.match = function (request) {
    // console.log(` ${request.hostname} ${request.path}  >>> ${this._domain} ${this.path}  `)
    //域名不匹配直接返回
    if(!(this._domain === "*" ||  this._domain === request.hostname || request.path.match(request.hostname))){
        return null
    }
    // 匹配路径
    if (this.pathRegex.test(request.path) && request.path.match(this.pathRegex)[0] === request.path) {
        if (!( this.handlers[request.method] || this.handlers['ALL']  || this.handlers['redirect'] || this.handlers['static']) ){
            return null;
        }
        if(this.handlers["redirect"]){
            return this.handlers["redirect"]
        }
        if(this.handlers["static"]){
            return this.handlers["static"]
        }
        // get values of named parameters
        let params = {};
        let paramsValues = request.path.match(this.pathRegex).slice(1);
        if(Object.keys(this.params).length > 0){
            for (let i = 0; i < paramsValues.length; i++) {
                params[this.params[i].name] = paramsValues[i];
            }
            request.params = params;
        }else{
            request.params = paramsValues;
        }
        // return handler for HTTP method
        let all;
        if (this.handlers[request.method]) {
            all = this.handlers[request.method];
        } else {
            // failback to all method
            // todo: add 403 error
            all = this.handlers['ALL'];
        }
        all = this._beforeFn.concat(all);
        return all;
    } else if (this._nesteds.length) {
        let ret;
        for (let j = 0; j < this._nesteds.length; j++) {
            if ((ret = this._nesteds[j].match(request))) {
                ret = this._beforeFn.concat(ret);
                return ret;
            }
        }
    }
    return null;
};


module.exports = Route;
