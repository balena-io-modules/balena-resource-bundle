# balena-resource-bundle

Create a TypeScript/JS SDK for handling the new Balena resource bundle
format. The focus of this project is to develop a lightweight SDK that
offers a polished and user-friendly API. The SDK should preferably
utilize a well-established, readily available tar handling library
while minimizing external dependencies. It must provide essential
routines for both reading and creating files in the new resource
bundle format. Users of the SDK should be able to access the contents
of the bundle while it is still being read from the tar.gz stream. The
SDK will utilize the Node.js Streams API.
