Oni Express
===========

👹ni: a modular, scalable, searchable data repository.

Datasets are stored on disk according to the [Oxford Common File Layout - OCFL](https://ocfl.io/) - a standard for maintaining immutable, platform-independent file-based repositories.

Datasets are described using [RO-Crate](https://researchobject.github.io/ro-crate/) - a lightweight standard for research metadata based on [JSON-LD](https://json-ld.org/) and [Schema.org](https://schema.org/).

Datasets are indexed into a [Solr](https://lucene.apache.org/solr/) database, providing high-performace faceted search and discovery based on selected metadata fields.

## Components

This repository contains the core component, **oni-express** - a Node web app  with three endpoints:

* a single-page app with search and browse interface
* a proxy for the Solr index
* an OCFL bridge which serves versioned datastreams from the repository

[**oni-portal**](https://github.com/UTS-eResearch/oni-portal) is the repository for the single-page app's JavaScript. There isn't any need to install it separately unless you're developing custom components: the oni-express deployment (see below) will deploy and configure the appropriate release for you.

[**oni-indexer**](https://github.com/UTS-eResearch/oni-indexer) is a stand-alone node script which traverses the OCFL repository and builds the Solr index. 

## Deploying Oni

The easiest way to deploy Oni is with the Dockerfile and docker-compose.yml in this repository. Put an OCFL repository in a directory called `sample_ocfl` in the repository directory, or, alternately, edit the `volumes` line in the oni-express section of the docker-compose.yml file so that it maps your OCFL repository to `/etc/share/ocfl`  

    services:
      oni-express:
        build: .
        ports:
          - "8080:8080"
        expose:
          - "80"
        networks:
          - main
        volumes:
          - "./sample_ocfl:/etc/share/ocfl"

Then start Docker with:

    > docker-compose up

The data portal should be available on https://localhost:8080/

## Configuring and indexing

### Volumes


### Web server

The oni-express web server is configured with `/config/config.json`

The base config is divided into environments, for example:

* development
* uat
* production

Each environment contains the following sections:

#### auth

Auth can be omitted if you want to run oni-express without authentication.

At the moment, the only authentication protocol supported is the Australian Access Federation's [AAF Rapid Connect](https://rapid.aaf.edu.au/). Development of an Azure AD connector is underway.

* secret - key obtained when registering the AAF Rapid Connect endpoint
* authURL - URL obtained when registering the AAF Rapid Connect endpoint
* iss - either "https://rapid.test.aaf.edu.au" or "https://rapid.test.aaf.edu.au"
* aud - the domain this instance of Oni is running on
* success - the jwt endpoint, usually "http://oni.domain/jwt",
* attributes - "https://aaf.edu.au/attributes",
* allow - a set of regexps to be matched against attribute values, for eg:
  - "uid": "uts.edu.au"
  - "affiliation": "^staff@uts.edu.au$"


#### session

Configuration options for the session cookies used if authentication is on. The only value you need to change is `secret`, which should be given something unique and secret.

* secret - Salt for session fingerprinting. Change this to a random value.
* name - Cookie session name
* expiry - Session cookie expiry time in hours
* server - location of the memcached server on the Docker network

#### cors

Enables CORS so that oni can run in dev mode with components on different domains, which would otherwise be blocked by browsers. This should be set to `false` when running in production.

#### solr

Address of the Solr server on the Docker network. You shouldn't have to change this.

#### ocfl

Configures at least one OCFL repository, as follows:

* repository - directory of the repository on the Docker container - see the section on Volumes for more details
* autoindex - allow auto-indexes for the top level and inside OCFL objects
* versions - allow URLS to return versions other than HEAD
* type - filter objects by their type in the Solr index
* page_size - number of items to return on an auto-index page
* solr - URL of this repositories Solr core
* resolver - whether to use solr or pairtree to resolve URLs to OCFL paths

### Portal

The data portal is configured with `/config/portal.config.json`, which is copied to the oni-express Docker container when rebuilding.




### Indexing


## Limitations

A future release will make it more convenient to deploy the OCFL bridge without the web front-end, to meet use cases where the search/discovery portal is not required.

At present, it still needs to be installed and configured separately to oni-express. A future release will bundle oni-indexer into the Docker stack for oni-express so this won't be necessary.

## Roadmap

## History

## Oni?

The original oni 👹 is a Japanese ogre - kind of shaggy and fierce, though they have their softer side in some legends - and the name is a loose acronym:

O - OCFL Objects
n - nginx or node (or whatever else moves datastreams over the network)
i - index

It's not ONI, though, it's Oni.

