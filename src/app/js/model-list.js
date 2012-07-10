/**
Provides an API for managing an ordered list of Model instances.

@module app
@submodule model-list
@since 3.4.0
**/

/**
Provides an API for managing an ordered list of Model instances.

In addition to providing convenient `add`, `create`, `reset`, and `remove`
methods for managing the models in the list, ModelLists are also bubble targets
for events on the model instances they contain. This means, for example, that
you can add several models to a list, and then subscribe to the `*:change` event
on the list to be notified whenever any model in the list changes.

ModelLists also maintain sort order efficiently as models are added and removed,
based on a custom `comparator` function you may define (if no comparator is
defined, models are sorted in insertion order).

@class ModelList
@extends Base
@uses ArrayList
@constructor
@since 3.4.0
**/

var AttrProto = Y.Attribute.prototype,
    Lang      = Y.Lang,
    YArray    = Y.Array,

    /**
    Fired when a model is added to the list.

    Listen to the `on` phase of this event to be notified before a model is
    added to the list. Calling `e.preventDefault()` during the `on` phase will
    prevent the model from being added.

    Listen to the `after` phase of this event to be notified after a model has
    been added to the list.

    @event add
    @param {Model} model The model being added.
    @param {Number} index The index at which the model will be added.
    @preventable _defAddFn
    **/
    EVT_ADD = 'add',

    /**
    Fired when a model is created or updated via the `create()` method, but
    before the model is actually saved or added to the list. The `add` event
    will be fired after the model has been saved and added to the list.

    @event create
    @param {Model} model The model being created/updated.
    @since 3.5.0
    **/
    EVT_CREATE = 'create',

    /**
    Fired when an error occurs, such as when an attempt is made to add a
    duplicate model to the list, or when a sync layer response can't be parsed.

    @event error
    @param {Any} error Error message, object, or exception generated by the
      error. Calling `toString()` on this should result in a meaningful error
      message.
    @param {String} src Source of the error. May be one of the following (or any
      custom error source defined by a ModelList subclass):

      * `add`: Error while adding a model (probably because it's already in the
         list and can't be added again). The model in question will be provided
         as the `model` property on the event facade.
      * `parse`: An error parsing a JSON response. The response in question will
         be provided as the `response` property on the event facade.
      * `remove`: Error while removing a model (probably because it isn't in the
        list and can't be removed). The model in question will be provided as
        the `model` property on the event facade.
    **/
    EVT_ERROR = 'error',

    /**
    Fired after models are loaded from a sync layer.

    @event load
    @param {Object} parsed The parsed version of the sync layer's response to
        the load request.
    @param {Mixed} response The sync layer's raw, unparsed response to the load
        request.
    @since 3.5.0
    **/
    EVT_LOAD = 'load',

    /**
    Fired when a model is removed from the list.

    Listen to the `on` phase of this event to be notified before a model is
    removed from the list. Calling `e.preventDefault()` during the `on` phase
    will prevent the model from being removed.

    Listen to the `after` phase of this event to be notified after a model has
    been removed from the list.

    @event remove
    @param {Model} model The model being removed.
    @param {Number} index The index of the model being removed.
    @preventable _defRemoveFn
    **/
    EVT_REMOVE = 'remove',

    /**
    Fired when the list is completely reset via the `reset()` method or sorted
    via the `sort()` method.

    Listen to the `on` phase of this event to be notified before the list is
    reset. Calling `e.preventDefault()` during the `on` phase will prevent
    the list from being reset.

    Listen to the `after` phase of this event to be notified after the list has
    been reset.

    @event reset
    @param {Model[]} models Array of the list's new models after the reset.
    @param {String} src Source of the event. May be either `'reset'` or
      `'sort'`.
    @preventable _defResetFn
    **/
    EVT_RESET = 'reset';

function ModelList() {
    ModelList.superclass.constructor.apply(this, arguments);
}

Y.ModelList = Y.extend(ModelList, Y.Base, {
    // -- Public Properties ----------------------------------------------------

    /**
    The `Model` class or subclass of the models in this list.

    The class specified here will be used to create model instances
    automatically based on attribute hashes passed to the `add()`, `create()`,
    and `reset()` methods.

    You may specify the class as an actual class reference or as a string that
    resolves to a class reference at runtime (the latter can be useful if the
    specified class will be loaded lazily).

    @property model
    @type Model|String
    @default Y.Model
    **/
    model: Y.Model,

    // -- Protected Properties -------------------------------------------------

    /**
    Total hack to allow us to identify ModelList instances without using
    `instanceof`, which won't work when the instance was created in another
    window or YUI sandbox.

    @property _isYUIModelList
    @type Boolean
    @default true
    @protected
    @since 3.5.0
    **/
    _isYUIModelList: true,

    // -- Lifecycle Methods ----------------------------------------------------
    initializer: function (config) {
        config || (config = {});

        var model = this.model = config.model || this.model;

        if (typeof model === 'string') {
            // Look for a namespaced Model class on `Y`.
            this.model = Y.Object.getValue(Y, model.split('.'));

            if (!this.model) {
                Y.error('ModelList: Model class not found: ' + model);
            }
        }

        this.publish(EVT_ADD,    {defaultFn: this._defAddFn});
        this.publish(EVT_RESET,  {defaultFn: this._defResetFn});
        this.publish(EVT_REMOVE, {defaultFn: this._defRemoveFn});

        this.after('*:idChange', this._afterIdChange);

        this._clear();
    },

    destructor: function () {
        this._clear();
    },

    // -- Public Methods -------------------------------------------------------

    /**
    Adds the specified model or array of models to this list. You may also pass
    another ModelList instance, in which case all the models in that list will
    be added to this one as well.

    @example

        // Add a single model instance.
        list.add(new Model({foo: 'bar'}));

        // Add a single model, creating a new instance automatically.
        list.add({foo: 'bar'});

        // Add multiple models, creating new instances automatically.
        list.add([
            {foo: 'bar'},
            {baz: 'quux'}
        ]);

        // Add all the models in another ModelList instance.
        list.add(otherList);

    @method add
    @param {Model|Model[]|ModelList|Object|Object[]} models Model or array of
        models to add. May be existing model instances or hashes of model
        attributes, in which case new model instances will be created from the
        hashes. You may also pass a ModelList instance to add all the models it
        contains.
    @param {Object} [options] Data to be mixed into the event facade of the
        `add` event(s) for the added models.

        @param {Number} [options.index] Index at which to insert the added
            models. If not specified, the models will automatically be inserted
            in the appropriate place according to the current sort order as
            dictated by the `comparator()` method, if any.
        @param {Boolean} [options.silent=false] If `true`, no `add` event(s)
            will be fired.

    @return {Model|Model[]} Added model or array of added models.
    **/
    add: function (models, options) {
        var isList = models._isYUIModelList;

        if (isList || Lang.isArray(models)) {
            return YArray.map(isList ? models.toArray() : models, function (model, index) {
                var modelOptions = options || {};

                // When an explicit insertion index is specified, ensure that
                // the index is increased by one for each subsequent item in the
                // array.
                if ('index' in modelOptions) {
                    modelOptions = Y.merge(modelOptions, {
                        index: modelOptions.index + index
                    });
                }

                return this._add(model, modelOptions);
            }, this);
        } else {
            return this._add(models, options);
        }
    },

    /**
    Define this method to provide a function that takes a model as a parameter
    and returns a value by which that model should be sorted relative to other
    models in this list.

    By default, no comparator is defined, meaning that models will not be sorted
    (they'll be stored in the order they're added).

    @example
        var list = new Y.ModelList({model: Y.Model});

        list.comparator = function (model) {
            return model.get('id'); // Sort models by id.
        };

    @method comparator
    @param {Model} model Model being sorted.
    @return {Number|String} Value by which the model should be sorted relative
      to other models in this list.
    **/

    // comparator is not defined by default

    /**
    Creates or updates the specified model on the server, then adds it to this
    list if the server indicates success.

    @method create
    @param {Model|Object} model Model to create. May be an existing model
      instance or a hash of model attributes, in which case a new model instance
      will be created from the hash.
    @param {Object} [options] Options to be passed to the model's `sync()` and
        `set()` methods and mixed into the `create` and `add` event facades.
      @param {Boolean} [options.silent=false] If `true`, no `add` event(s) will
          be fired.
    @param {Function} [callback] Called when the sync operation finishes.
      @param {Error} callback.err If an error occurred, this parameter will
        contain the error. If the sync operation succeeded, _err_ will be
        falsy.
      @param {Any} callback.response The server's response.
    @return {Model} Created model.
    **/
    create: function (model, options, callback) {
        var self = this;

        // Allow callback as second arg.
        if (typeof options === 'function') {
            callback = options;
            options  = {};
        }

        options || (options = {});

        if (!model._isYUIModel) {
            model = new this.model(model);
        }

        self.fire(EVT_CREATE, Y.merge(options, {
            model: model
        }));

        return model.save(options, function (err) {
            if (!err) {
                self.add(model, options);
            }

            callback && callback.apply(null, arguments);
        });
    },

    /**
    Executes the supplied function on each model in this list.

    By default, the callback function's `this` object will refer to the model
    currently being iterated. Specify a `thisObj` to override the `this` object
    if desired.

    Note: Iteration is performed on a copy of the internal array of models, so
    it's safe to delete a model from the list during iteration.

    @method each
    @param {Function} callback Function to execute on each model.
        @param {Model} callback.model Model instance.
        @param {Number} callback.index Index of the current model.
        @param {ModelList} callback.list The ModelList being iterated.
    @param {Object} [thisObj] Object to use as the `this` object when executing
        the callback.
    @chainable
    @since 3.6.0
    **/
    each: function (callback, thisObj) {
        var items = this._items.concat(),
            i, item, len;

        for (i = 0, len = items.length; i < len; i++) {
            item = items[i];
            callback.call(thisObj || item, item, i, this);
        }

        return this;
    },

    /**
    Executes the supplied function on each model in this list. Returns an array
    containing the models for which the supplied function returned a truthy
    value.

    The callback function's `this` object will refer to this ModelList. Use
    `Y.bind()` to bind the `this` object to another object if desired.

    @example

        // Get an array containing only the models whose "enabled" attribute is
        // truthy.
        var filtered = list.filter(function (model) {
            return model.get('enabled');
        });

        // Get a new ModelList containing only the models whose "enabled"
        // attribute is truthy.
        var filteredList = list.filter({asList: true}, function (model) {
            return model.get('enabled');
        });

    @method filter
    @param {Object} [options] Filter options.
        @param {Boolean} [options.asList=false] If truthy, results will be
            returned as a new ModelList instance rather than as an array.

    @param {Function} callback Function to execute on each model.
        @param {Model} callback.model Model instance.
        @param {Number} callback.index Index of the current model.
        @param {ModelList} callback.list The ModelList being filtered.

    @return {Array|ModelList} Array of models for which the callback function
        returned a truthy value (empty if it never returned a truthy value). If
        the `options.asList` option is truthy, a new ModelList instance will be
        returned instead of an array.
    @since 3.5.0
    */
    filter: function (options, callback) {
        var filtered = [],
            items    = this._items,
            i, item, len, list;

        // Allow options as first arg.
        if (typeof options === 'function') {
            callback = options;
            options  = {};
        }

        for (i = 0, len = items.length; i < len; ++i) {
            item = items[i];

            if (callback.call(this, item, i, this)) {
                filtered.push(item);
            }
        }

        if (options.asList) {
            list = new this.constructor({model: this.model});

            if (filtered.length) {
                list.add(filtered, {silent: true});
            }

            return list;
        } else {
            return filtered;
        }
    },

    /**
    If _name_ refers to an attribute on this ModelList instance, returns the
    value of that attribute. Otherwise, returns an array containing the values
    of the specified attribute from each model in this list.

    @method get
    @param {String} name Attribute name or object property path.
    @return {Any|Array} Attribute value or array of attribute values.
    @see Model.get()
    **/
    get: function (name) {
        if (this.attrAdded(name)) {
            return AttrProto.get.apply(this, arguments);
        }

        return this.invoke('get', name);
    },

    /**
    If _name_ refers to an attribute on this ModelList instance, returns the
    HTML-escaped value of that attribute. Otherwise, returns an array containing
    the HTML-escaped values of the specified attribute from each model in this
    list.

    The values are escaped using `Escape.html()`.

    @method getAsHTML
    @param {String} name Attribute name or object property path.
    @return {String|String[]} HTML-escaped value or array of HTML-escaped
      values.
    @see Model.getAsHTML()
    **/
    getAsHTML: function (name) {
        if (this.attrAdded(name)) {
            return Y.Escape.html(AttrProto.get.apply(this, arguments));
        }

        return this.invoke('getAsHTML', name);
    },

    /**
    If _name_ refers to an attribute on this ModelList instance, returns the
    URL-encoded value of that attribute. Otherwise, returns an array containing
    the URL-encoded values of the specified attribute from each model in this
    list.

    The values are encoded using the native `encodeURIComponent()` function.

    @method getAsURL
    @param {String} name Attribute name or object property path.
    @return {String|String[]} URL-encoded value or array of URL-encoded values.
    @see Model.getAsURL()
    **/
    getAsURL: function (name) {
        if (this.attrAdded(name)) {
            return encodeURIComponent(AttrProto.get.apply(this, arguments));
        }

        return this.invoke('getAsURL', name);
    },

    /**
    Returns the model with the specified _clientId_, or `null` if not found.

    @method getByClientId
    @param {String} clientId Client id.
    @return {Model} Model, or `null` if not found.
    **/
    getByClientId: function (clientId) {
        return this._clientIdMap[clientId] || null;
    },

    /**
    Returns the model with the specified _id_, or `null` if not found.

    Note that models aren't expected to have an id until they're saved, so if
    you're working with unsaved models, it may be safer to call
    `getByClientId()`.

    @method getById
    @param {String|Number} id Model id.
    @return {Model} Model, or `null` if not found.
    **/
    getById: function (id) {
        return this._idMap[id] || null;
    },

    /**
    Calls the named method on every model in the list. Any arguments provided
    after _name_ will be passed on to the invoked method.

    @method invoke
    @param {String} name Name of the method to call on each model.
    @param {Any} [args*] Zero or more arguments to pass to the invoked method.
    @return {Array} Array of return values, indexed according to the index of
      the model on which the method was called.
    **/
    invoke: function (name /*, args* */) {
        var args = [this._items, name].concat(YArray(arguments, 1, true));
        return YArray.invoke.apply(YArray, args);
    },

    /**
    Returns the model at the specified _index_.

    @method item
    @param {Number} index Index of the model to fetch.
    @return {Model} The model at the specified index, or `undefined` if there
      isn't a model there.
    **/

    // item() is inherited from ArrayList.

    /**
    Loads this list of models from the server.

    This method delegates to the `sync()` method to perform the actual load
    operation, which is an asynchronous action. Specify a _callback_ function to
    be notified of success or failure.

    If the load operation succeeds, a `reset` event will be fired.

    @method load
    @param {Object} [options] Options to be passed to `sync()` and to
      `reset()` when adding the loaded models. It's up to the custom sync
      implementation to determine what options it supports or requires, if any.
    @param {Function} [callback] Called when the sync operation finishes.
      @param {Error} callback.err If an error occurred, this parameter will
        contain the error. If the sync operation succeeded, _err_ will be
        falsy.
      @param {Any} callback.response The server's response. This value will
        be passed to the `parse()` method, which is expected to parse it and
        return an array of model attribute hashes.
    @chainable
    **/
    load: function (options, callback) {
        var self = this;

        // Allow callback as only arg.
        if (typeof options === 'function') {
            callback = options;
            options  = {};
        }

        options || (options = {});

        this.sync('read', options, function (err, response) {
            var facade = {
                    options : options,
                    response: response
                },

                parsed;

            if (err) {
                facade.error = err;
                facade.src   = 'load';

                self.fire(EVT_ERROR, facade);
            } else {
                // Lazy publish.
                if (!self._loadEvent) {
                    self._loadEvent = self.publish(EVT_LOAD, {
                        preventable: false
                    });
                }

                parsed = facade.parsed = self.parse(response);

                self.reset(parsed, options);
                self.fire(EVT_LOAD, facade);
            }

            callback && callback.apply(null, arguments);
        });

        return this;
    },

    /**
    Executes the specified function on each model in this list and returns an
    array of the function's collected return values.

    @method map
    @param {Function} fn Function to execute on each model.
      @param {Model} fn.model Current model being iterated.
      @param {Number} fn.index Index of the current model in the list.
      @param {Model[]} fn.models Array of models being iterated.
    @param {Object} [thisObj] `this` object to use when calling _fn_.
    @return {Array} Array of return values from _fn_.
    **/
    map: function (fn, thisObj) {
        return YArray.map(this._items, fn, thisObj);
    },

    /**
    Called to parse the _response_ when the list is loaded from the server.
    This method receives a server _response_ and is expected to return an array
    of model attribute hashes.

    The default implementation assumes that _response_ is either an array of
    attribute hashes or a JSON string that can be parsed into an array of
    attribute hashes. If _response_ is a JSON string and either `Y.JSON` or the
    native `JSON` object are available, it will be parsed automatically. If a
    parse error occurs, an `error` event will be fired and the model will not be
    updated.

    You may override this method to implement custom parsing logic if necessary.

    @method parse
    @param {Any} response Server response.
    @return {Object[]} Array of model attribute hashes.
    **/
    parse: function (response) {
        if (typeof response === 'string') {
            try {
                return Y.JSON.parse(response) || [];
            } catch (ex) {
                this.fire(EVT_ERROR, {
                    error   : ex,
                    response: response,
                    src     : 'parse'
                });

                return null;
            }
        }

        return response || [];
    },

    /**
    Removes the specified model or array of models from this list. You may also
    pass another ModelList instance to remove all the models that are in both
    that instance and this instance, or pass numerical indices to remove the
    models at those indices.

    @method remove
    @param {Model|Model[]|ModelList|Number|Number[]} models Models or indices of
        models to remove.
    @param {Object} [options] Data to be mixed into the event facade of the
        `remove` event(s) for the removed models.

        @param {Boolean} [options.silent=false] If `true`, no `remove` event(s)
            will be fired.

    @return {Model|Model[]} Removed model or array of removed models.
    **/
    remove: function (models, options) {
        var isList = models._isYUIModelList;

        if (isList || Lang.isArray(models)) {
            // We can't remove multiple models by index because the indices will
            // change as we remove them, so we need to get the actual models
            // first.
            models = YArray.map(isList ? models.toArray() : models, function (model) {
                if (Lang.isNumber(model)) {
                    return this.item(model);
                }

                return model;
            }, this);

            return YArray.map(models, function (model) {
                return this._remove(model, options);
            }, this);
        } else {
            return this._remove(models, options);
        }
    },

    /**
    Completely replaces all models in the list with those specified, and fires a
    single `reset` event.

    Use `reset` when you want to add or remove a large number of items at once
    with less overhead, and without firing `add` or `remove` events for each
    one.

    @method reset
    @param {Model[]|ModelList|Object[]} [models] Models to add. May be existing
        model instances or hashes of model attributes, in which case new model
        instances will be created from the hashes. If a ModelList is passed, all
        the models in that list will be added to this list. Calling `reset()`
        without passing in any models will clear the list.
    @param {Object} [options] Data to be mixed into the event facade of the
        `reset` event.

        @param {Boolean} [options.silent=false] If `true`, no `reset` event will
            be fired.

    @chainable
    **/
    reset: function (models, options) {
        models  || (models  = []);
        options || (options = {});

        var facade = Y.merge({src: 'reset'}, options);

        if (models._isYUIModelList) {
            models = models.toArray();
        } else {
            models = YArray.map(models, function (model) {
                return model._isYUIModel ? model : new this.model(model);
            }, this);
        }

        facade.models = models;

        if (options.silent) {
            this._defResetFn(facade);
        } else {
            // Sort the models before firing the reset event.
            if (this.comparator) {
                models.sort(Y.bind(this._sort, this));
            }

            this.fire(EVT_RESET, facade);
        }

        return this;
    },

    /**
    Executes the supplied function on each model in this list, and stops
    iterating if the callback returns `true`.

    By default, the callback function's `this` object will refer to the model
    currently being iterated. Specify a `thisObj` to override the `this` object
    if desired.

    Note: Iteration is performed on a copy of the internal array of models, so
    it's safe to delete a model from the list during iteration.

    @method some
    @param {Function} callback Function to execute on each model.
        @param {Model} callback.model Model instance.
        @param {Number} callback.index Index of the current model.
        @param {ModelList} callback.list The ModelList being iterated.
    @param {Object} [thisObj] Object to use as the `this` object when executing
        the callback.
    @return {Boolean} `true` if the callback returned `true` for any item,
        `false` otherwise.
    @since 3.6.0
    **/
    some: function (callback, thisObj) {
        var items = this._items.concat(),
            i, item, len;

        for (i = 0, len = items.length; i < len; i++) {
            item = items[i];

            if (callback.call(thisObj || item, item, i, this)) {
                return true;
            }
        }

        return false;
    },

    /**
    Forcibly re-sorts the list.

    Usually it shouldn't be necessary to call this method since the list
    maintains its sort order when items are added and removed, but if you change
    the `comparator` function after items are already in the list, you'll need
    to re-sort.

    @method sort
    @param {Object} [options] Data to be mixed into the event facade of the
        `reset` event.
      @param {Boolean} [options.silent=false] If `true`, no `reset` event will
          be fired.
    @chainable
    **/
    sort: function (options) {
        if (!this.comparator) {
            return this;
        }

        var models = this._items.concat(),
            facade;

        options || (options = {});

        models.sort(Y.bind(this._sort, this));

        facade = Y.merge(options, {
            models: models,
            src   : 'sort'
        });

        options.silent ? this._defResetFn(facade) :
                this.fire(EVT_RESET, facade);

        return this;
    },

    /**
    Override this method to provide a custom persistence implementation for this
    list. The default method just calls the callback without actually doing
    anything.

    This method is called internally by `load()`.

    @method sync
    @param {String} action Sync action to perform. May be one of the following:

      * `create`: Store a list of newly-created models for the first time.
      * `delete`: Delete a list of existing models.
      * `read`  : Load a list of existing models.
      * `update`: Update a list of existing models.

      Currently, model lists only make use of the `read` action, but other
      actions may be used in future versions.

    @param {Object} [options] Sync options. It's up to the custom sync
      implementation to determine what options it supports or requires, if any.
    @param {Function} [callback] Called when the sync operation finishes.
      @param {Error} callback.err If an error occurred, this parameter will
        contain the error. If the sync operation succeeded, _err_ will be
        falsy.
      @param {Any} [callback.response] The server's response. This value will
        be passed to the `parse()` method, which is expected to parse it and
        return an array of model attribute hashes.
    **/
    sync: function (/* action, options, callback */) {
        var callback = YArray(arguments, 0, true).pop();

        if (typeof callback === 'function') {
            callback();
        }
    },

    /**
    Returns an array containing the models in this list.

    @method toArray
    @return {Array} Array containing the models in this list.
    **/
    toArray: function () {
        return this._items.concat();
    },

    /**
    Returns an array containing attribute hashes for each model in this list,
    suitable for being passed to `Y.JSON.stringify()`.

    Under the hood, this method calls `toJSON()` on each model in the list and
    pushes the results into an array.

    @method toJSON
    @return {Object[]} Array of model attribute hashes.
    @see Model.toJSON()
    **/
    toJSON: function () {
        return this.map(function (model) {
            return model.toJSON();
        });
    },

    // -- Protected Methods ----------------------------------------------------

    /**
    Adds the specified _model_ if it isn't already in this list.

    If the model's `clientId` or `id` matches that of a model that's already in
    the list, an `error` event will be fired and the model will not be added.

    @method _add
    @param {Model|Object} model Model or object to add.
    @param {Object} [options] Data to be mixed into the event facade of the
        `add` event for the added model.
      @param {Boolean} [options.silent=false] If `true`, no `add` event will be
          fired.
    @return {Model} The added model.
    @protected
    **/
    _add: function (model, options) {
        var facade, id;

        options || (options = {});

        if (!model._isYUIModel) {
            model = new this.model(model);
        }

        id = model.get('id');

        if (this._clientIdMap[model.get('clientId')]
                || (Lang.isValue(id) && this._idMap[id])) {

            this.fire(EVT_ERROR, {
                error: 'Model is already in the list.',
                model: model,
                src  : 'add'
            });

            return;
        }

        facade = Y.merge(options, {
            index: 'index' in options ? options.index : this._findIndex(model),
            model: model
        });

        options.silent ? this._defAddFn(facade) : this.fire(EVT_ADD, facade);

        return model;
    },

    /**
    Adds this list as a bubble target for the specified model's events.

    @method _attachList
    @param {Model} model Model to attach to this list.
    @protected
    **/
    _attachList: function (model) {
        // Attach this list and make it a bubble target for the model.
        model.lists.push(this);
        model.addTarget(this);
    },

    /**
    Clears all internal state and the internal list of models, returning this
    list to an empty state. Automatically detaches all models in the list.

    @method _clear
    @protected
    **/
    _clear: function () {
        YArray.each(this._items, this._detachList, this);

        this._clientIdMap = {};
        this._idMap       = {};
        this._items       = [];
    },

    /**
    Compares the value _a_ to the value _b_ for sorting purposes. Values are
    assumed to be the result of calling a model's `comparator()` method. You can
    override this method to implement custom sorting logic, such as a descending
    sort or multi-field sorting.

    @method _compare
    @param {Mixed} a First value to compare.
    @param {Mixed} b Second value to compare.
    @return {Number} `-1` if _a_ should come before _b_, `0` if they're
        equivalent, `1` if _a_ should come after _b_.
    @protected
    @since 3.5.0
    **/
    _compare: function (a, b) {
        return a < b ? -1 : (a > b ? 1 : 0);
    },

    /**
    Removes this list as a bubble target for the specified model's events.

    @method _detachList
    @param {Model} model Model to detach.
    @protected
    **/
    _detachList: function (model) {
        var index = YArray.indexOf(model.lists, this);

        if (index > -1) {
            model.lists.splice(index, 1);
            model.removeTarget(this);
        }
    },

    /**
    Returns the index at which the given _model_ should be inserted to maintain
    the sort order of the list.

    @method _findIndex
    @param {Model} model The model being inserted.
    @return {Number} Index at which the model should be inserted.
    @protected
    **/
    _findIndex: function (model) {
        var items = this._items,
            max   = items.length,
            min   = 0,
            item, middle, needle;

        if (!this.comparator || !max) {
            return max;
        }

        needle = this.comparator(model);

        // Perform an iterative binary search to determine the correct position
        // based on the return value of the `comparator` function.
        while (min < max) {
            middle = (min + max) >> 1; // Divide by two and discard remainder.
            item   = items[middle];

            if (this._compare(this.comparator(item), needle) < 0) {
                min = middle + 1;
            } else {
                max = middle;
            }
        }

        return min;
    },

    /**
    Removes the specified _model_ if it's in this list.

    @method _remove
    @param {Model|Number} model Model or index of the model to remove.
    @param {Object} [options] Data to be mixed into the event facade of the
        `remove` event for the removed model.
      @param {Boolean} [options.silent=false] If `true`, no `remove` event will
          be fired.
    @return {Model} Removed model.
    @protected
    **/
    _remove: function (model, options) {
        var index, facade;

        options || (options = {});

        if (Lang.isNumber(model)) {
            index = model;
            model = this.item(index);
        } else {
            index = this.indexOf(model);
        }

        if (index === -1 || !model) {
            this.fire(EVT_ERROR, {
                error: 'Model is not in the list.',
                index: index,
                model: model,
                src  : 'remove'
            });

            return;
        }

        facade = Y.merge(options, {
            index: index,
            model: model
        });

        options.silent ? this._defRemoveFn(facade) :
                this.fire(EVT_REMOVE, facade);

        return model;
    },

    /**
    Array sort function used by `sort()` to re-sort the models in the list.

    @method _sort
    @param {Model} a First model to compare.
    @param {Model} b Second model to compare.
    @return {Number} `-1` if _a_ is less than _b_, `0` if equal, `1` if greater.
    @protected
    **/
    _sort: function (a, b) {
        return this._compare(this.comparator(a), this.comparator(b));
    },

    // -- Event Handlers -------------------------------------------------------

    /**
    Updates the model maps when a model's `id` attribute changes.

    @method _afterIdChange
    @param {EventFacade} e
    @protected
    **/
    _afterIdChange: function (e) {
        var newVal  = e.newVal,
            prevVal = e.prevVal,
            target  = e.target;

        if (Lang.isValue(prevVal)) {
            if (this._idMap[prevVal] === target) {
                delete this._idMap[prevVal];
            } else {
                // The model that changed isn't in this list. Probably just a
                // bubbled change event from a nested Model List.
                return;
            }
        } else {
            // The model had no previous id. Verify that it exists in this list
            // before continuing.
            if (this.indexOf(target) === -1) {
                return;
            }
        }

        if (Lang.isValue(newVal)) {
            this._idMap[newVal] = target;
        }
    },

    // -- Default Event Handlers -----------------------------------------------

    /**
    Default event handler for `add` events.

    @method _defAddFn
    @param {EventFacade} e
    @protected
    **/
    _defAddFn: function (e) {
        var model = e.model,
            id    = model.get('id');

        this._clientIdMap[model.get('clientId')] = model;

        if (Lang.isValue(id)) {
            this._idMap[id] = model;
        }

        this._attachList(model);
        this._items.splice(e.index, 0, model);
    },

    /**
    Default event handler for `remove` events.

    @method _defRemoveFn
    @param {EventFacade} e
    @protected
    **/
    _defRemoveFn: function (e) {
        var model = e.model,
            id    = model.get('id');

        this._detachList(model);
        delete this._clientIdMap[model.get('clientId')];

        if (Lang.isValue(id)) {
            delete this._idMap[id];
        }

        this._items.splice(e.index, 1);
    },

    /**
    Default event handler for `reset` events.

    @method _defResetFn
    @param {EventFacade} e
    @protected
    **/
    _defResetFn: function (e) {
        // When fired from the `sort` method, we don't need to clear the list or
        // add any models, since the existing models are sorted in place.
        if (e.src === 'sort') {
            this._items = e.models.concat();
            return;
        }

        this._clear();

        if (e.models.length) {
            this.add(e.models, {silent: true});
        }
    }
}, {
    NAME: 'modelList'
});

Y.augment(ModelList, Y.ArrayList);
