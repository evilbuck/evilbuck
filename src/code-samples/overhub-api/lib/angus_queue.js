const _ = require('lodash');
const Bull = require('bull');
const { QueueJobProcessedError } = require('./errors/bull_queue_errors');
const config = require('config');

/**
 * @typedef {object} AngusQueueOptions
 * @property {object} queueOptions - options passed to Bull Queue
 * @property {function} [hashFn] - optional hashing algorithm for job id
 */

class AngusQueue extends Bull {
  /**
   *
   * @param {string} name - queue name
   * @param {string} url redis url
   * @param {AngusQueueOptions} options - extended version of bull queue options to support hashing and conflict management
   */
  constructor(name, url, options) {
    let newName = name;
    let hash;

    if (!url) {
      throw new Error('You must set redis url in your queue');
    }

    // handle use case of optional url argument
    if (!_.isString(url)) {
      options = url;
    }

    if (options) {
      let { hashFn = undefined, ...parentOptions } = options;
      hash = hashFn;
      options = parentOptions;
    }

    super(newName, url, options);

    if (hash) {
      this.hashFn = hash;
    } else {
      this.hashFn = () => null;
    }
  }

  /**
   * add
   * Adds a job to the queue of named choice
   *
   * @param {string} name
   * @param {object} data
   * @param {object} options
   * @param {string} options.jobId - optional jobId to use
   */
  async add(name, data, options = {}) {
    // use this to build up the args that should be used to call the super constructor
    // TODO: clean this up. It's ugly and confusing as to why it's happening
    const newArgs = [];

    if (!_.isString(name)) {
      options = data || {};
      data = name;
      newArgs.push(data);
      newArgs.push(options);
    } else {
      newArgs.push(name);
      newArgs.push(data);
      newArgs.push(options);
    }

    let { jobId } = options;
    if (!jobId) {
      jobId = await this.hashFn(data);
      options.jobId = jobId;
    }

    // setup defaults for failed jobs and retry options & strategies
    // TODO: allow overriding these options

    // Number of times to attempt a job before giving up
    options.attempts = config.get('bull.attempts');
    // NOTE: defined in config/default.js
    options.backoff = config.get('bull.backoff');

    // If no job id specified, skip the entire checking for conflict
    // Bull Queue will automatically create a unique job id
    if (jobId) {
      let existingJob = await this.getJob(jobId);

      // Only if there is an existing job with a conflicting jobId, do we need to attempt to debounce it.
      if (existingJob !== null) {
        // check to see if an attempt to process was made
        // we never want to replace an existing job that has already been processed
        if (existingJob.processedOn) {
          // throw a hard error if the job was already processed
          // the caller should handle this and record the error
          const error = new QueueJobProcessedError(
            `Job already processed. Create a new job. id: ${existingJob.id}`,
            {
              job: { id: existingJob.id, name: existingJob.name },
            }
          );

          throw error;
        }

        // TODO@queue: modify this to update delay (if there is one) to now + delayConfig
        await existingJob.remove();
      }
    }

    return super.add(...newArgs);
  }
}
module.exports = AngusQueue;
