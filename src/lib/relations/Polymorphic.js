
var Polymorphic =
{

  setReferences: function(database, field, options)
  {
    this.isRelatedFactory = this.isRelatedDiscriminatedFactory( this.isRelatedFactory );

    this.loadDiscriminators(function()
    {
      this.onInitialized( database, field, options );
    });
  },

  isRelatedDiscriminatedFactory: function(isRelatedFactory)
  {
    return function (model)
    {
      var isRelated = isRelatedFactory.call( this, model );
      var discriminator = this.getDiscriminatorForModel( model );
      var discriminatorField = this.discriminator;

      return function (related)
      {
        if ( !isRelated( related ) )
        {
          return false;
        }

        return equals( discriminator, related[ discriminatorField ] );
      };
    };
  },

  loadDiscriminators: function(onLoad)
  {
    var discriminators = this.discriminators;
    var total = sizeof( discriminators );
    var loaded = 0;

    function handleLoaded()
    {
      if ( ++loaded === total )
      {
        onLoad.apply( this );
      }
    }

    for (var name in discriminators)
    {
      var discriminator = discriminators[ name ];

      Rekord.get( name ).complete( this.setDiscriminated( discriminator, handleLoaded ), this );
    }
  },

  setDiscriminated: function(discriminator, onLoad)
  {
    return function(rekord)
    {
      this.discriminators[ rekord.Database.name ] = discriminator;
      this.discriminators[ rekord.Database.className ] = discriminator;
      this.discriminatorToModel[ discriminator ] = rekord;

      onLoad.apply( this );
    };
  },

  createRelationCollection: function(model)
  {
    return DiscriminateCollection( new RelationCollection( undefined, model, this ), this.discriminator, this.discriminatorToModel );
  },

  createCollection: function()
  {
    return DiscriminateCollection( new ModelCollection(), this.discriminator, this.discriminatorToModel );
  },

  ready: function(callback)
  {
    var models = this.discriminatorToModel;

    for ( var prop in models )
    {
      var model = models[ prop ];

      model.Database.ready( callback, this );
    }
  },

  listenToModelAdded: function(callback)
  {
    var models = this.discriminatorToModel;

    for ( var prop in models )
    {
      var model = models[ prop ];

      model.Database.on( Database.Events.ModelAdded, callback, this );
    }
  },

  executeQuery: function(model)
  {
    var queryOption = this.query;
    var queryOptions = this.queryOptions;
    var queryData = this.queryData;
    var query = isString( queryOption ) ? format( queryOption, model ) : queryOption;
    var search = model.search( query, queryOptions );

    if ( isObject( queryData ) )
    {
      search.$set( queryData );
    }

    DiscriminateCollection( search.$results, this.discriminator, this.discriminatorToModel );

    var promise = search.$run();
    promise.complete( this.handleExecuteQuery( model ), this );

    return search;
  },

  parseModel: function(input, remoteData)
  {
    if ( input instanceof Model )
    {
      return input;
    }
    else if ( isObject( input ) )
    {
      var db = this.getDiscriminatorDatabase( input );

      if ( db )
      {
        return db.parseModel( input, remoteData );
      }
    }

    return false;
  },

  clearFields: function(target, targetFields, remoteData)
  {
    var changes = clearFieldsReturnChanges( target, targetFields );

    if ( target[ this.discriminator ] )
    {
      target[ this.discriminator ] = null;
      changes = true;
    }

    if ( changes && !remoteData && this.auto && !target.$isNew() )
    {
      target.$save();
    }

    return changes;
  },

  updateFields: function(target, targetFields, source, sourceFields, remoteData)
  {
    var changes = updateFieldsReturnChanges( target, targetFields, source, sourceFields );

    var targetField = this.discriminator;
    var targetValue = target[ targetField ];
    var sourceValue = this.getDiscriminatorForModel( source );

    if ( !equals( targetValue, sourceValue ) )
    {
      target[ targetField ] = sourceValue;
      changes = true;
    }

    if ( changes )
    {
      if ( this.auto && !target.$isNew() && !remoteData )
      {
        target.$save();
      }

      target.$trigger( Model.Events.KeyUpdate, [target, source, targetFields, sourceFields] );
    }

    return changes;
  },

  grabInitial: function( model, fields )
  {
    var discriminator = this.discriminator;
    var discriminatorValue = model[ discriminator ];

    if ( hasFields( model, fields, isValue ) && isValue( discriminatorValue ) )
    {
      var related = this.discriminatorToModel[ discriminatorValue ];

      if ( related.Database )
      {
        var db = related.Database;
        var initial = {};

        initial[ discriminator ] = discriminatorValue;

        updateFieldsReturnChanges( initial, db.key, model, fields );

        return initial;
      }
    }
  },

  grabModel: function(input, callback, remoteData)
  {
    if ( isObject( input ) )
    {
      var db = this.getDiscriminatorDatabase( input );

      if ( db !== false )
      {
        db.grabModel( input, callback, this, remoteData );
      }
    }
  },

  grabModels: function(relation, initial, callback, remoteData)
  {
    for (var i = 0; i < initial.length; i++)
    {
      var input = initial[ i ];

      if ( input instanceof Model )
      {
        callback.call( this, input );
      }
      else if ( isObject( input ) )
      {
        var db = this.getDiscriminatorDatabase( input );

        if ( db )
        {
          var key = db.keyHandler.buildKeyFromInput( input );

          relation.pending[ key ] = true;

          db.grabModel( input, callback, this, remoteData );
        }
      }
    }
  },

  ownsForeignKey: function()
  {
    return true;
  },

  isModelArray: function(input)
  {
    return isArray( input );
  },

  getDiscriminator: function(model)
  {
    return model[ this.discriminator ];
  },

  getDiscriminatorDatabase: function(model)
  {
    var discriminator = this.getDiscriminator( model );
    var model = this.discriminatorToModel[ discriminator ];

    return model ? model.Database : false;
  },

  getDiscriminatorForModel: function(model)
  {
    return this.discriminators[ model.$db.name ];
  }

};
