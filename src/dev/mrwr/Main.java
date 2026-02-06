package dev.mrwr;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

public class Main {

	public static void main(String[] args) throws IOException {
		int port = 8080;
		
		// Create HTTP server bound to port 80
		HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);

		// Register a handler for the root path "/"
		server.createContext("/", new RootHandler());
		
		server.createContext("/hello", new HelloHandler());
		
		// Use default executor (single-threaded)
		ExecutorService executor = Executors.newFixedThreadPool(10);
		server.setExecutor(executor);

		System.out.println("Server started at http://localhost:" + port);
		server.start();
	}
	
	static class RootHandler implements HttpHandler {

		@Override
		public void handle(HttpExchange exchange) throws IOException {
			InputStream is = exchange.getRequestBody();
			try (OutputStream os = exchange.getResponseBody()) {
				String mrwr = "<!doctype html>\n"
						+ "<html>\n"
						+ "  <head>\n"
						+ "    <meta charset=\"utf-8\" />\n"
						+ "    <title>mrwr.dev</title>\n"
						+ "  </head>\n"
						+ "  <body>\n"
						+ "    coming soon\n"
						+ "    - linktr.ee/ratt.mouse"
						+ "  </body>\n"
						+ "</html>";
				os.write(mrwr.getBytes());
			}
		}
		
	}
	
	static class HelloHandler implements HttpHandler {
		@Override
		public void handle(HttpExchange exchange) throws IOException {
			String response = "hi...\n" + exchange.toString();

			exchange.sendResponseHeaders(200, response.length());

			String method = exchange.getRequestMethod();

			if ("GET".equalsIgnoreCase(method)) {
				// handle GET
				response += method + " -> ";
			} else if ("POST".equalsIgnoreCase(method)) {
				// handle POST
				response += method + " <- ";
			}
			
			InputStream is = exchange.getRequestBody();
			BufferedReader reader = new BufferedReader(new InputStreamReader(is, "UTF-8"));
			String body = reader.lines().collect(Collectors.joining("\n"));
			System.out.println(body);

			try (OutputStream os = exchange.getResponseBody()) {
				os.write(response.getBytes());
			}
		}
	}

}
