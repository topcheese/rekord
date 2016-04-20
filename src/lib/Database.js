

function Database(options)
{
  var defaults = Database.Defaults;

  // Apply the options to this database!
  applyOptions( this, options, defaults );

  // Apply options not specified in defaults
  for (var prop in options)
  {
    if ( !(prop in defaults) )
    {
      this[ prop ] = options[ prop ];
    }
  }

  // If key fields aren't in fields array, add them in
  var key = this.key;
  var fields = this.fields;
  if ( isArray( key ) )
  {
    for (var i = key.length - 1; i >= 0; i--)
    {
      if ( indexOf( fields, key[ i ] ) === false )
      {
        fields.unshift( key[ i ] );
      }
    }
  }
  else // isString( key )
  {
    if ( indexOf( fields, key ) === false )
    {
      fields.unshift( key );
    }
  }

  // Properties
  this.keys = toArray( this.key );
  this.models = new ModelCollection( this );
  this.all = {};
  this.loaded = {};
  this.className = this.className || toCamelCase( this.name );
  this.initialized = false;
  this.pendingRefresh = false;
  this.localLoaded = false;
  this.remoteLoaded = false;
  this.firstRefresh = false;
  this.pendingOperations = 0;
  this.afterOnline = false;
  this.saveFields = copy( fields );

  // Prepare
  this.prepare( this, options );

  // Services
  this.rest   = this.createRest( this );
  this.store  = this.createStore( this );
  this.live   = this.createLive( this );

  // Functions
  this.setComparator( this.comparator, this.comparatorNullsFirst );
  this.setRevision( this.revision );
  this.setSummarize( this.summarize );

  // Relations
  this.relations = {};
  this.relationNames = [];

  for (var relationType in options)
  {
    if ( !(relationType in Rekord.Relations) )
    {
      continue;
    }

    var RelationClass = Rekord.Relations[ relationType ];

    if ( !(RelationClass.prototype instanceof Relation ) )
    {
      continue;
    }

    var relationMap = options[ relationType ];

    for ( var name in relationMap )
    {
      var relationOptions = relationMap[ name ];
      var relation = new RelationClass();

      relation.init( this, name, relationOptions );

      if ( relation.save )
      {
        this.saveFields.push( name );
      }

      this.relations[ name ] = relation;
      this.relationNames.push( name );
    }
  }
}

function defaultEncode(model, data, forSaving)
{
  var encodings = this.encodings;

  for (var prop in data)
  {
    if ( prop in encodings )
    {
      data[ prop ] = encodings[ prop ]( data[ prop ], model, prop, forSaving );
    }
  }

  return data;
}

function defaultDecode(rawData)
{
  var decodings = this.decodings;

  for (var prop in rawData)
  {
    if ( prop in decodings )
    {
      rawData[ prop ] = decodings[ prop ]( rawData[ prop ], rawData, prop );
    }
  }

  return rawData;
}

function defaultSummarize(model)
{
  return model.$key();
}

function defaultCreateRest(database)
{
  return Rekord.rest( database );
}

function defaultCreateStore(database)
{
  return Rekord.store( database );
}

function defaultCreateLive( database )
{
  return Rekord.live( database );
}

function defaultResolveModel( response )
{
  return response;
}

function defaultResolveModels( response )
{
  return response;
}

Database.Events =
{
  NoLoad:       'no-load',
  RemoteLoad:   'remote-load',
  LocalLoad:    'local-load',
  Updated:      'updated',
  ModelAdded:   'model-added',
  ModelUpdated: 'model-updated',
  ModelRemoved: 'model-removed',
  Loads:        'no-load remote-load local-load',
  Changes:      'updated'
};

Database.Defaults =
{
  name:                 undefined,  // required
  className:            null,       // defaults to toCamelCase( name )
  key:                  'id',
  keySeparator:         '/',
  fields:               [],
  ignoredFields:        {},
  defaults:             {},
  comparator:           null,
  comparatorNullsFirst: null,
  revision:             null,
  loadRelations:        true,
  loadRemote:           true,
  autoRefresh:          true,
  cache:                Rekord.Cache.All,
  fullSave:             false,
  fullPublish:          false,
  encodings:            {},
  decodings:            {},
  prepare:              noop,
  encode:               defaultEncode,
  decode:               defaultDecode,
  resolveModel:         defaultResolveModel,
  resolveModels:        defaultResolveModels,
  summarize:            defaultSummarize,
  createRest:           defaultCreateRest,
  createStore:          defaultCreateStore,
  createLive:           defaultCreateLive
};

addMethods( Database.prototype,
{

  // Notifies a callback when the database has loaded (either locally or remotely).
  ready: function(callback, context, persistent)
  {
    var db = this;
    var callbackContext = context || db;
    var invoked = false;

    if ( db.initialized )
    {
      callback.call( callbackContext, db );

      invoked = true;
    }

    if ( !db.initialized || persistent )
    {
      function onReady()
      {
        if ( !persistent )
        {
          off();
        }
        if ( !invoked || persistent )
        {
          if ( callback.call( callbackContext, db ) === false )
          {
            off();
          }

          invoked = true;
        }
      }

      var off = db.on( Database.Events.Loads, onReady );
    }

    return invoked;
  },

  // Determines whether the given object has data to save
  hasData: function(saving)
  {
    if ( !isObject( saving ) )
    {
      return false;
    }

    for (var prop in saving)
    {
      if ( !this.ignoredFields[ prop ] )
      {
        return true;
      }
    }

    return false;
  },

  // Grab a model with the given input and notify the callback
  grabModel: function(input, callback, context, remoteData)
  {
    var db = this;
    var callbackContext = context || db;
    var grabbed = false;

    function checkModel()
    {
      var result = db.parseModel( input, remoteData );

      if ( result !== false && !grabbed )
      {
        if ( !db.loadRemote && !db.remoteLoaded && (result === null || !result.$isSaved()) )
        {
          if ( !result )
          {
            result = db.buildObjectFromKey( db.buildKeyFromInput( input ) );
          }

          result.$once( Model.Events.RemoteGets, function()
          {
            if ( !grabbed )
            {
              grabbed = true;

              if ( isObject( input ) )
              {
                result.$set( input );
              }

              callback.call( callbackContext, result.$isSaved() ? result : null );
            }
          });

          result.$refresh();
        }
        else
        {
          grabbed = true;
          callback.call( callbackContext, result );
        }
      }

      return grabbed ? false : true;
    }

    if ( checkModel() )
    {
      db.ready( checkModel, db, true );
    }
  },

  // Parses the model from the given input
  //
  // Returns false if the input doesn't resolve to a model at the moment
  // Returns null if the input doesn't resolve to a model and all models have been remotely loaded
  //
  // parseModel( Rekord )
  // parseModel( Rekord.Model )
  // parseModel( 'uuid' )
  // parseModel( ['uuid'] )
  // parseModel( modelInstance )
  // parseModel( {name:'new model'} )
  // parseModel( {id:4, name:'new or existing model'} )
  //
  parseModel: function(input, remoteData)
  {
    var db = this;
    var hasRemote = db.remoteLoaded || !db.loadRemote;

    if ( !isValue( input ) )
    {
      return hasRemote ? null : false;
    }

    if ( isRekord( input ) )
    {
      input = new input();
    }
    if ( isFunction( input ) )
    {
      input = input();
    }

    var key = db.buildKeyFromInput( input );

    if ( input instanceof db.Model )
    {
      return input;
    }
    else if ( key in db.all )
    {
      var model = db.all[ key ];

      if ( isObject( input ) )
      {
        if ( remoteData )
        {
          db.putRemoteData( input, key, model );
        }
        else
        {
          model.$set( input );
        }
      }

      return model;
    }
    else if ( isObject( input ) )
    {
      if ( remoteData )
      {
        return db.putRemoteData( input );
      }
      else
      {
        return db.instantiate( db.decode( input ) );
      }
    }
    else if ( hasRemote )
    {
      return null;
    }

    return false;
  },

  // Removes the key from the given model
  removeKey: function(model)
  {
    var k = this.key;

    if ( isArray(k) )
    {
      for (var i = 0; i < k.length; i++)
      {
        delete model[ k[i] ];
      }
    }
    else
    {
      delete model[ k ];
    }
  },

  // Builds a key string from the given model and array of fields
  buildKey: function(model, fields)
  {
    var key = this.buildKeys( model, fields );

    if ( isArray( key ) )
    {
      key = key.join( this.keySeparator );
    }

    return key;
  },

  // Builds a key (possibly array) from the given model and array of fields
  buildKeys: function(model, fields)
  {
    var key = null;

    if ( isArray( fields ) )
    {
      key = [];

      for (var i = 0; i < fields.length; i++)
      {
        key.push( model[ fields[i] ] );
      }
    }
    else
    {
      key = model[ fields ];

      if (!key)
      {
        key = model[ fields ] = uuid();
      }
    }

    return key;
  },

  // Builds a key from various types of input.
  buildKeyFromInput: function(input)
  {
    if ( input instanceof this.Model )
    {
      return input.$key();
    }
    else if ( isArray( input ) ) // && isArray( this.key )
    {
      return this.buildKeyFromArray( input );
    }
    else if ( isObject( input ) )
    {
      return this.buildKey( input, this.key );
    }

    return input;
  },

  // Builds a key from an array
  buildKeyFromArray: function(arr)
  {
    return arr.join( this.keySeparator );
  },

  // Gets the key from the given model
  getKey: function(model, quietly)
  {
    var key = this.key;
    var modelKey = this.buildKey( model, key );

    if ( hasFields( model, key, isValue ) )
    {
      return modelKey;
    }
    else if ( !quietly )
    {
      throw 'Composite key not supplied.';
    }

    return false;
  },

  // Gets the key from the given model
  getKeys: function(model)
  {
    return this.buildKeys( model, this.key );
  },

  buildObjectFromKey: function(key)
  {
    var db = this;

    var props = {};

    if ( isArray( db.key ) )
    {
      if ( isString( key ) )
      {
        key = key.split( db.keySeparator );
      }

      for (var i = 0; i < db.key.length; i++)
      {
        props[ db.key[ i ] ] = key[ i ];
      }
    }
    else
    {
      props[ db.key ] = key;
    }

    return db.instantiate( props );
  },

  // Sorts the models & notifies listeners that the database has been updated.
  updated: function()
  {
    this.sort(); // TODO remove
    this.trigger( Database.Events.Updated );
  },

  // Sets a revision comparision function for this database. It can be a field
  // name or a function. This is used to avoid updating model data that is older
  // than the model's current data.
  setRevision: function(revision)
  {
    if ( isFunction( revision ) )
    {
      this.revisionFunction = revision;
    }
    else if ( isString( revision ) )
    {
      this.revisionFunction = function(a, b)
      {
        var ar = isObject( a ) && revision in a ? a[ revision ] : undefined;
        var br = isObject( b ) && revision in b ? b[ revision ] : undefined;

        return ar === undefined || br === undefined ? false : compare( ar, br ) > 0;
      };
    }
    else
    {
      this.revisionFunction = function(a, b)
      {
        return false;
      };
    }
  },

  // Sets a comparator for this database. It can be a field name, a field name
  // with a minus in the front to sort in reverse, or a comparator function.
  setComparator: function(comparator, nullsFirst)
  {
    this.models.setComparator( comparator, nullsFirst );
  },

  addComparator: function(comparator, nullsFirst)
  {
    this.models.addComparator( comparator, nullsFirst );
  },

  setSummarize: function(summarize)
  {
    if ( isFunction( summarize ) )
    {
      this.summarize = summarize;
    }
    else if ( isString( summarize ) )
    {
      if ( indexOf( this.fields, summarize ) !== false )
      {
        this.summarize = function(model)
        {
          return isValue( model ) ? model[ summarize ] : model;
        };
      }
      else
      {
        this.summarize = createFormatter( summarize );
      }
    }
    else
    {
      this.summarize = function(model)
      {
        return model.$key();
      };
    }
  },

  // Sorts the database if it isn't sorted.
  sort: function()
  {
    this.models.sort();
  },

  // Determines whether this database is sorted.
  isSorted: function()
  {
    return this.models.isSorted();
  },

  clean: function()
  {
    var db = this;
    var keys = db.models.keys;
    var models = db.models;

    db.all = {};

    for (var i = 0; i < keys.length; i++)
    {
      db.all[ keys[ i ] ] = models[ i ];
    }
  },

  // Handles when we receive data from the server - either from
  // a publish, refresh, or values being returned on a save.
  putRemoteData: function(encoded, key, model, overwrite)
  {
    if ( !isObject( encoded ) )
    {
      return model;
    }

    var db = this;
    var key = key || db.getKey( encoded );
    var model = model || db.all[ key ];
    var decoded = db.decode( copy( encoded ) );

    // Reject the data if it's a lower revision
    if ( model )
    {
      var revisionRejected = this.revisionFunction( model, encoded );

      if ( revisionRejected )
      {
        Rekord.debug( Rekord.Debugs.SAVE_OLD_REVISION, db, model, encoded );

        return model;
      }
    }

    // If the model already exists, update it.
    if ( model )
    {
      var keyFields = db.keys;

      for (var i = 0; i < keyFields.length; i++)
      {
        var k = keyFields[ i ];
        var mk = model[ k ];
        var dk = decoded[ k ];

        if ( isValue( mk ) && isValue( dk ) && mk !== dk )
        {
          throw new Error('Model keys cannot be changed');
        }
      }

      db.all[ key ] = model;

      if ( !model.$saved )
      {
        model.$saved = {};
      }

      var current = model.$toJSON( true );
      var conflicts = {};
      var conflicted = false;
      var updated = {};
      var notReallySaved = isEmpty( model.$saved );
      var relations = db.relations;

      for (var prop in encoded)
      {
        if ( prop.charAt(0) === '$' )
        {
          continue;
        }

        if ( prop in relations )
        {
          model.$set( prop, encoded[ prop ], true );

          continue;
        }

        var currentValue = current[ prop ];
        var savedValue = model.$saved[ prop ];

        if ( notReallySaved || overwrite || equals( currentValue, savedValue ) )
        {
          model[ prop ] = decoded[ prop ];
          updated[ prop ] = encoded[ prop ];

          if ( model.$local )
          {
            model.$local[ prop ] = encoded[ prop ];
          }
        }
        else
        {
          conflicts[ prop ] = encoded[ prop ];
          conflicted = true;
        }

        model.$saved[ prop ] = copy( encoded[ prop ] );
      }

      if ( conflicted )
      {
        model.$trigger( Model.Events.PartialUpdate, [encoded, conflicts] );
      }
      else
      {
        model.$trigger( Model.Events.FullUpdate, [encoded, updated] );
      }

      model.$trigger( Model.Events.RemoteUpdate, [encoded] );

      model.$addOperation( SaveNow );

      if ( !db.models.has( key ) )
      {
        db.models.put( key, model );
        db.trigger( Database.Events.ModelAdded, [model, true] );
      }
    }
    // The model doesn't exist, create it.
    else
    {
      model = db.createModel( decoded, true );

      if ( db.cache === Rekord.Cache.All )
      {
        model.$local = model.$toJSON( false );
        model.$local.$status = model.$status;
        model.$saved = model.$local.$saved = model.$toJSON( true );

        model.$addOperation( SaveNow );
      }
      else
      {
        model.$saved = model.$toJSON( true );
      }
    }

    return model;
  },

  createModel: function(decoded, remoteData)
  {
    var db = this;
    var model = db.instantiate( decoded, remoteData );
    var key = model.$key();

    if ( !db.models.has( key ) )
    {
      db.models.put( key, model );
      db.trigger( Database.Events.ModelAdded, [model, remoteData] );
    }

    return model;
  },

  destroyLocalUncachedModel: function(model, key)
  {
    var db = this;

    if ( model )
    {
      if ( model.$hasChanges() )
      {
        delete model.$saved;

        db.removeKey( model );

        model.$trigger( Model.Events.Detach );

        return false;
      }

      delete db.all[ key ];

      db.models.remove( key );
      db.trigger( Database.Events.ModelRemoved, [model] );

      model.$trigger( Model.Events.RemoteAndRemove );

      Rekord.debug( Rekord.Debugs.REMOTE_REMOVE, db, model );

      return true;
    }

    return false;
  },

  destroyLocalCachedModel: function(model, key)
  {
    var db = this;

    if ( model )
    {
      // If a model was removed remotely but the model has changes - don't remove it.
      if ( model.$hasChanges() )
      {
        // Removed saved history and the current ID
        delete model.$saved;
        delete model.$local.$saved;

        db.removeKey( model );
        db.removeKey( model.$local );

        model.$trigger( Model.Events.Detach );

        model.$addOperation( SaveNow );

        return false;
      }

      model.$addOperation( RemoveNow );

      delete db.all[ key ];

      db.models.remove( key );
      db.trigger( Database.Events.ModelRemoved, [model] );

      model.$trigger( Model.Events.RemoteAndRemove );

      Rekord.debug( Rekord.Debugs.REMOTE_REMOVE, db, model );
    }
    else
    {
      db.store.remove( key, function(removedValue)
      {
        if (removedValue)
        {
          Rekord.debug( Rekord.Debugs.REMOTE_REMOVE, db, removedValue );
        }
      });

      // The model didn't exist
      return false;
    }

    return true;
  },

  // Destroys a model locally because it doesn't exist remotely
  destroyLocalModel: function(key)
  {
    var db = this;
    var model = db.all[ key ];

    if ( db.cache === Rekord.Cache.All )
    {
      return db.destroyLocalCachedModel( model, key );
    }
    else
    {
      return db.destroyLocalUncachedModel( model, key );
    }
  },

  loadFinish: function()
  {
    var db = this;

    for (var key in db.loaded)
    {
      var model = db.loaded[ key ];

      if ( model.$status === Model.Status.RemovePending )
      {
        Rekord.debug( Rekord.Debugs.LOCAL_RESUME_DELETE, db, model );

        model.$addOperation( RemoveRemote );
      }
      else
      {
        if ( model.$status === Model.Status.SavePending )
        {
          Rekord.debug( Rekord.Debugs.LOCAL_RESUME_SAVE, db, model );

          model.$addOperation( SaveRemote );
        }
        else
        {
          Rekord.debug( Rekord.Debugs.LOCAL_LOAD_SAVED, db, model );
        }

        db.models.put( key, model, true );
      }
    }

    db.loaded = {};
    db.updated();

    if ( db.loadRemote )
    {
      if ( db.pendingOperations === 0 )
      {
        db.refresh();
      }
      else
      {
        db.firstRefresh = true;
      }
    }
  },

  loadBegin: function(onLoaded)
  {
    var db = this;

    function onLocalLoad(records, keys)
    {
      Rekord.debug( Rekord.Debugs.LOCAL_LOAD, db, records );

      for (var i = 0; i < records.length; i++)
      {
        var encoded = records[ i ];
        var key = keys[ i ];
        var decoded = db.decode( copy( encoded, true ) );
        var model = db.instantiate( decoded, true );

        model.$local = encoded;
        model.$saved = encoded.$saved;

        if ( model.$status !== Model.Status.Removed )
        {
          db.loaded[ key ] = model;
          db.all[ key ] = model;
        }
      }

      db.initialized = true;
      db.localLoaded = true;

      db.trigger( Database.Events.LocalLoad, [db] );

      onLoaded( true, db );
    }

    function onLocalError()
    {
      db.loadNone();

      onLoaded( false, db );
    }

    if ( db.loadRemote && db.autoRefresh )
    {
      Rekord.after( Rekord.Events.Online, db.onOnline, db );
    }

    if ( db.cache === Rekord.Cache.None )
    {
      db.loadNone();

      onLoaded( false, db );
    }
    else
    {
      db.store.all( onLocalLoad, onLocalError );
    }
  },

  loadNone: function()
  {
    var db = this;

    if ( db.loadRemote )
    {
      db.refresh();
    }
    else
    {
      db.initialized = true;
      db.trigger( Database.Events.NoLoad, [db] );
    }
  },

  onOnline: function()
  {
    this.afterOnline = true;

    if ( this.pendingOperations === 0 )
    {
      this.onOperationRest();
    }
  },

  onOperationRest: function()
  {
    var db = this;

    if ( ( db.autoRefresh && db.remoteLoaded && db.afterOnline ) || db.firstRefresh )
    {
      db.afterOnline = false;
      db.firstRefresh = false;

      Rekord.debug( Rekord.Debugs.AUTO_REFRESH, db );

      db.refresh();
    }
  },

  // Loads all data remotely
  refresh: function(callback, context)
  {
    var db = this;
    var callbackContext = context || db;

    function onModels(response)
    {
      var models = db.resolveModels( response );
      var mapped = {};

      for (var i = 0; i < models.length; i++)
      {
        var model = db.putRemoteData( models[ i ] );

        if ( model )
        {
          var key = model.$key();

          mapped[ key ] = model;
        }
      }

      var keys = db.models.keys();

      for (var i = 0; i < keys.length; i++)
      {
        var k = keys[ i ];

        if ( !(k in mapped) )
        {
          var old = db.models.get( k );

          if ( old.$saved )
          {
            Rekord.debug( Rekord.Debugs.REMOTE_LOAD_REMOVE, db, k );

            db.destroyLocalModel( k );
          }
        }
      }

      db.initialized = true;
      db.remoteLoaded = true;

      db.trigger( Database.Events.RemoteLoad, [db] );

      db.updated();

      Rekord.debug( Rekord.Debugs.REMOTE_LOAD, db, models );

      if ( callback )
      {
        callback.call( callbackContext, db.models );
      }
    }

    function onLoadError(response, status)
    {
      if ( status === 0 )
      {
        Rekord.checkNetworkStatus();

        if ( !Rekord.online )
        {
          db.pendingRefresh = true;

          Rekord.once( Rekord.Events.Online, db.onRefreshOnline, db );
        }

        Rekord.debug( Rekord.Debugs.REMOTE_LOAD_OFFLINE, db );
      }
      else
      {
        Rekord.debug( Rekord.Debugs.REMOTE_LOAD_ERROR, db, status );

        db.initialized = true;
        db.trigger( Database.Events.NoLoad, [db, response] );
      }

      if ( callback )
      {
        callback.call( callbackContext, db.models );
      }
    }

    db.rest.all( onModels, onLoadError );
  },

  onRefreshOnline: function()
  {
    var db = this;

    Rekord.debug( Rekord.Debugs.REMOTE_LOAD_RESUME, db );

    if ( db.pendingRefresh )
    {
      db.pendingRefresh = false;

      db.refresh();
    }
  },

  // Returns a model
  get: function(key)
  {
    return this.all[ this.buildKeyFromInput( key ) ];
  },

  filter: function(isValid)
  {
    var all = this.all;
    var filtered = [];

    for (var key in all)
    {
      var model = all[ key ];

      if ( isValid( model ) )
      {
        filtered.push( model );
      }
    }

    return filtered;
  },

  liveSave: function(key, encoded)
  {
    this.putRemoteData( encoded, key );
    this.updated();

    Rekord.debug( Rekord.Debugs.REALTIME_SAVE, this, encoded, key );
  },

  liveRemove: function(key)
  {
    if ( this.destroyLocalModel( key ) )
    {
      this.updated();
    }

    Rekord.debug( Rekord.Debugs.REALTIME_REMOVE, this, key );
  },

  // Return an instance of the model with the data as initial values
  instantiate: function(data, remoteData)
  {
    return new this.Model( data, remoteData );
  },

  addReference: function(model)
  {
    this.all[ model.$key() ] = model;
  },

  // Save the model
  save: function(model, cascade)
  {
    var db = this;

    if ( model.$isDeleted() )
    {
      Rekord.debug( Rekord.Debugs.SAVE_DELETED, db, model );

      return;
    }

    var key = model.$key();
    var existing = db.models.has( key );

    if ( existing )
    {
      db.trigger( Database.Events.ModelUpdated, [model] );

      model.$trigger( Model.Events.UpdateAndSave );
    }
    else
    {
      db.models.put( key, model );
      db.trigger( Database.Events.ModelAdded, [model] );
      db.updated();

      model.$trigger( Model.Events.CreateAndSave );
    }

    model.$addOperation( SaveLocal, cascade );
  },

  // Remove the model
  remove: function(model, cascade)
  {
    var db = this;

    // If we have it in the models, remove it!
    this.removeFromModels( model );

    // If we're offline and we have a pending save - cancel the pending save.
    if ( model.$status === Model.Status.SavePending )
    {
      Rekord.debug( Rekord.Debugs.REMOVE_CANCEL_SAVE, db, model );
    }

    model.$status = Model.Status.RemovePending;

    model.$addOperation( RemoveLocal, cascade );
  },

  removeFromModels: function(model)
  {
    var db = this;
    var key = model.$key();

    if ( db.models.has( key ) )
    {
      db.models.remove( key );
      db.trigger( Database.Events.ModelRemoved, [model] );
      db.updated();

      model.$trigger( Model.Events.Removed );
    }
  },

  refreshModel: function(model, cascade)
  {
    model.$addOperation( GetRemote, cascade );
  }

});

eventize( Database.prototype );
addEventFunction( Database.prototype, 'change', Database.Events.Changes );